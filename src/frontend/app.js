import init, { measure_resolver } from './wasm/pkg/dns_resolver_recommender.js?v=1779109982';

let resolvers = [];

const API_BASE = "https://dns.diic-hpi.org/api";
const MEASUREMENT_TIMEOUT_MS = 3000; // 3-second hard timeout per DoH query

const btn = document.getElementById("start-btn");
const progress = document.getElementById("progress");
const table = document.getElementById("results-table");
const tbody = document.getElementById("results-body");
const optInBox = document.getElementById("opt-in-telemetry");

// Expose copy and toggle helper functions globally for onclick handlers in the template
window.toggleSetup = (id) => {
    const el = document.getElementById(id);
    if (el) {
        el.style.display = el.style.display === "none" || el.style.display === "" ? "block" : "none";
    }
};

window.copyText = (text, btnId) => {
    navigator.clipboard.writeText(text).then(() => {
        const copyBtn = document.getElementById(btnId);
        if (copyBtn) {
            const oldText = copyBtn.textContent;
            copyBtn.textContent = "Copied!";
            setTimeout(() => {
                copyBtn.textContent = oldText;
            }, 1500);
        }
    }).catch(err => {
        console.error("Failed to copy: ", err);
    });
};

async function loadResolvers() {
    try {
        const response = await fetch(`${API_BASE}/resolvers`);
        if (!response.ok) throw new Error("Failed to load resolvers list");
        const list = await response.json();
        resolvers = list.map(r => ({
            id: r.id,
            name: r.name,
            url: r.url,
            ip_address: r.ip_address,
            cors: r.url.includes("cloudflare-dns") || r.url.includes("dns.cloudflare") || r.url.includes("dns.google") || r.url.includes("8.8.8.8"),
            dnssec: r.dnssec,
            no_logs: r.no_logs,
            no_filter: r.no_filter,
            country: r.country,
            description: r.description
        }));
    } catch (e) {
        console.error(e);
        resolvers = [
            { id: "cloudflare", name: "Cloudflare", url: "https://cloudflare-dns.com/dns-query", ip_address: "1.1.1.1", cors: true, dnssec: true, no_logs: true, no_filter: true, country: "US", description: "Cloudflare public DNS" },
            { id: "google", name: "Google", url: "https://dns.google/dns-query", ip_address: "8.8.8.8", cors: true, dnssec: true, no_logs: false, no_filter: true, country: "US", description: "Google public DNS" },
            { id: "cleanbrowsing", name: "CleanBrowsing", url: "https://doh.cleanbrowsing.org/doh/family-filter/", ip_address: "185.228.168.168", cors: false, dnssec: true, no_logs: true, no_filter: false, country: "US", description: "CleanBrowsing family filtering" },
            { id: "quad9", name: "Quad9", url: "https://dns.quad9.net/dns-query", ip_address: "9.9.9.9", cors: false, dnssec: true, no_logs: true, no_filter: false, country: "US", description: "Quad9 security filtering" }
        ];
    }
}

async function measureOneResolver(resolver) {
    const cachedEl = document.getElementById(`cached-${resolver.id}`);
    const uncachedEl = document.getElementById(`uncached-${resolver.id}`);
    const scoreEl = document.getElementById(`score-${resolver.id}`);
    const statusEl = document.getElementById(`status-${resolver.id}`);
    
    if (statusEl) statusEl.textContent = "Measuring...";
    
    try {
        // 1. Connection Warm-up & Dynamic CORS Detection
        let detectedCors = resolver.cors;
        let warmupFailed = false;
        try {
            // Try CORS query first
            const warmUpRes = await measure_resolver(resolver.url, "example.com", true, MEASUREMENT_TIMEOUT_MS);
            if (warmUpRes.status === "ok" || warmUpRes.status.includes("NOERROR")) {
                detectedCors = true;
            } else if (warmUpRes.status === "Timeout") {
                // Resolver timed out on CORS - try no-CORS before giving up
                try {
                    const fallbackRes = await measure_resolver(resolver.url, "example.com", false, MEASUREMENT_TIMEOUT_MS);
                    if (fallbackRes.status === "Timeout") {
                        warmupFailed = true;
                    }
                    detectedCors = false;
                } catch (e2) {
                    warmupFailed = true;
                }
            } else {
                // CORS not supported or returned opaque/error, try No-CORS fallback
                await measure_resolver(resolver.url, "example.com", false, MEASUREMENT_TIMEOUT_MS);
                detectedCors = false;
            }
        } catch (e) {
            // CORS failed (e.g. CORS block TypeError), try No-CORS fallback
            try {
                const fallbackRes = await measure_resolver(resolver.url, "example.com", false, MEASUREMENT_TIMEOUT_MS);
                if (fallbackRes.status === "Timeout") {
                    warmupFailed = true;
                }
                detectedCors = false;
            } catch (e2) {
                // Both failed, resolver is dead
                warmupFailed = true;
                detectedCors = false;
            }
        }
        resolver.cors = detectedCors;

        // Fast-path: if warmup failed entirely, skip this resolver
        if (warmupFailed) {
            if (cachedEl) cachedEl.textContent = "Dead";
            if (uncachedEl) uncachedEl.textContent = "Dead";
            if (scoreEl) scoreEl.textContent = "Dead";
            if (statusEl) statusEl.textContent = "Timeout / Offline";
            return {
                resolver,
                cachedAvg: null,
                uncachedAvg: null,
                score: null,
                status: "dead",
                statusText: "Timeout / Offline",
                cachedTimes: [],
                uncachedTimes: []
            };
        }

        // 2. Cached Measurement (7 queries, discarding the first 2 to eliminate cold-start/TLS bias).
        // Empirical testing showed that discarding only 1 query is insufficient: TCP slow-start,
        // TLS session ticket exchange, and HTTP/2 stream initialization take 2-3 round-trips
        // to fully stabilize. Using 5 kept queries means a single outlier moves the mean by ~20%
        // instead of the ~50% distortion caused by a spike in 3 kept queries.
        const cachedTimes = [];
        const allCachedRaw = []; // ALL 7 including warmup, for research analysis
        let cachedStatus = "ok";
        for (let j = 0; j < 7; j++) {
            try {
                const res = await measure_resolver(resolver.url, "example.com", resolver.cors, MEASUREMENT_TIMEOUT_MS);
                if (res.status === "ok" || res.status.includes("NOERROR") || res.status.includes("opaque")) {
                    allCachedRaw.push(res.latency_ms); // keep all 7
                    if (j > 1) { // Discard the first 2 queries (j=0 and j=1)
                        cachedTimes.push(res.latency_ms);
                    }
                } else if (res.status === "Timeout") {
                    if (statusEl) statusEl.textContent = "Partial Timeout";
                } else {
                    cachedStatus = res.status;
                }
            } catch (e) {
                cachedStatus = "Fetch Error (CORS/Network)";
            }
        }
        // allCachedRaw stores the full 7-query profile (including discarded j=0,1)
        // for potential future analysis. Not displayed in the UI.

        const cachedAvg = cachedTimes.length > 0
            ? cachedTimes.reduce((a, b) => a + b, 0) / cachedTimes.length
            : null;

        if (cachedEl) {
            cachedEl.innerHTML = cachedAvg !== null
                ? `${cachedAvg.toFixed(1)} ms<br><small style="color:gray; font-size:11px;">[${cachedTimes.map(t => t.toFixed(1)).join(", ")}]</small>`
                : "Fail";
        }

        // 3. Uncached Measurement (5 queries to unique UUID subdomains, same sample size as cached)
        const uncachedTimes = [];
        let uncachedStatus = "ok";
        const resolverDomains = [
            crypto.randomUUID() + ".diic-hpi.org",
            crypto.randomUUID() + ".diic-hpi.org",
            crypto.randomUUID() + ".diic-hpi.org",
            crypto.randomUUID() + ".diic-hpi.org",
            crypto.randomUUID() + ".diic-hpi.org"
        ];

        for (let j = 0; j < 5; j++) {
            const domain = resolverDomains[j];
            try {
                const res = await measure_resolver(resolver.url, domain, resolver.cors, MEASUREMENT_TIMEOUT_MS);
                if (res.status === "ok" || res.status.includes("NOERROR") || res.status.includes("opaque")) {
                    uncachedTimes.push(res.latency_ms);
                } else if (res.status === "Timeout") {
                    if (statusEl) statusEl.textContent = "Partial Timeout";
                } else {
                    uncachedStatus = res.status;
                }
            } catch (e) {
                uncachedStatus = "Measurement Error";
            }
        }
        
        const uncachedAvg = uncachedTimes.length > 0
            ? uncachedTimes.reduce((a, b) => a + b, 0) / uncachedTimes.length
            : null;

        if (uncachedAvg) {
            if (uncachedEl) {
                uncachedEl.innerHTML = `${uncachedAvg.toFixed(1)} ms<br><small style="color:gray; font-size:11px;">[${uncachedTimes.map(t => t.toFixed(1)).join(", ")}]</small>`;
            }
            if (statusEl) statusEl.textContent = resolver.cors ? "Success" : "Opaque (Unverified)";
        } else {
            if (uncachedEl) uncachedEl.textContent = "Fail";
            if (statusEl) statusEl.textContent = uncachedStatus;
        }

        // Calculate Weighted Performance Score (80% Cached + 20% Uncached)
        const score = (cachedAvg !== null && uncachedAvg !== null)
            ? (0.8 * cachedAvg + 0.2 * uncachedAvg)
            : null;

        if (scoreEl) {
            scoreEl.innerHTML = score !== null ? `<strong>${score.toFixed(1)} ms</strong>` : "Fail";
        }
        
        return {
            resolver,
            cachedAvg,
            uncachedAvg,
            score,
            status: score !== null ? "ok" : "fail",
            statusText: score !== null ? (resolver.cors ? "Success" : "Opaque (Unverified)") : uncachedStatus,
            domains: resolverDomains,
            cachedTimes,
            uncachedTimes
        };

    } catch (err) {
        if (cachedEl) cachedEl.textContent = "Fail";
        if (uncachedEl) uncachedEl.textContent = "Fail";
        if (scoreEl) scoreEl.textContent = "Fail";
        if (statusEl) statusEl.textContent = "Error";
        return {
            resolver,
            cachedAvg: null,
            uncachedAvg: null,
            score: null,
            status: "fail",
            statusText: "Error",
            cachedTimes: [],
            uncachedTimes: []
        };
    }
}

async function runMeasurements() {
    if (resolvers.length === 0) {
        progress.textContent = "Error: Resolvers list is empty.";
        return;
    }

    btn.disabled = true;
    tbody.innerHTML = "";
    table.style.display = "table";
    
    try {
        await init({ module_or_path: './wasm/pkg/dns_resolver_recommender_bg.wasm?v=' + Date.now() }); // Initialize Wasm with cache-busting
        
        progress.textContent = "Initializing measurements...";

        // Render pending rows for all resolvers
        resolvers.forEach(resolver => {
            const tr = document.createElement("tr");
            tr.id = `row-${resolver.id}`;
            
            const metaTags = [];
            if (resolver.country) metaTags.push(resolver.country);
            if (resolver.dnssec) metaTags.push("DNSSEC");
            if (resolver.no_logs) metaTags.push("No-Logs");
            if (resolver.no_filter) metaTags.push("Unfiltered");
            const metaTagsStr = metaTags.length > 0 ? `<br><small style="color:gray; font-size:11px;">[${metaTags.join(" | ")}]</small>` : "";

            const setupId = `setup-${resolver.id}`;
            const escapedUrl = resolver.url.replace(/'/g, "\\'");
            const escapedIp = (resolver.ip_address || "").replace(/'/g, "\\'");
            const ipGuide = resolver.ip_address 
                ? `<p style="margin:5px 0;"><strong>System DNS IP:</strong> <code>${resolver.ip_address}</code> <button class="copy-btn" id="copy-ip-${resolver.id}" onclick="copyText('${escapedIp}', 'copy-ip-${resolver.id}')">Copy</button></p>`
                : `<p style="margin:5px 0; color: gray;"><strong>System DNS IP:</strong> Not specified in stamp.</p>`;

            const corsHtml = !resolver.cors
                ? `<p style="margin:5px 0; color: #d35400;"><strong>CORS Status:</strong> ⚠️ No-CORS (measured via browser opaque mode)</p>`
                : `<p style="margin:5px 0; color: #27ae60;"><strong>CORS Status:</strong> ✅ Supports CORS (fully verified browser queries)</p>`;

            const guideHtml = `
                <div id="${setupId}" class="setup-details" style="display: none;">
                    <p style="margin:5px 0 10px 0; color: #7f8c8d; font-size:12px;">${resolver.description || 'No additional description provided.'}</p>
                    <p style="margin:5px 0;"><strong>Browser (DoH URL):</strong> <code>${resolver.url}</code> <button class="copy-btn" id="copy-url-${resolver.id}" onclick="copyText('${escapedUrl}', 'copy-url-${resolver.id}')">Copy</button></p>
                    ${ipGuide}
                    ${corsHtml}
                    <small style="color: #7f8c8d; display:block; margin-top:8px;">Enter the DoH URL in your browser's Secure DNS settings (e.g. Chrome/Firefox Settings -> Secure DNS) or use the IP in your system network settings.</small>
                </div>
            `;

            tr.innerHTML = `
                <td>
                    <strong>${resolver.name}</strong> 
                    <button class="setup-guide-btn" onclick="toggleSetup('${setupId}')">⚙️ Setup</button>
                    ${metaTagsStr}
                    ${guideHtml}
                </td>
                <td id="cached-${resolver.id}">Pending...</td>
                <td id="uncached-${resolver.id}">Pending...</td>
                <td id="score-${resolver.id}">Pending...</td>
                <td id="status-${resolver.id}" class="status">Waiting...</td>
            `;
            tbody.appendChild(tr);
        });

        const BATCH_SIZE = 15;
        const results = [];
        for (let i = 0; i < resolvers.length; i += BATCH_SIZE) {
            const batch = resolvers.slice(i, i + BATCH_SIZE);
            progress.textContent = `Measuring batch ${Math.floor(i / BATCH_SIZE) + 1} of ${Math.ceil(resolvers.length / BATCH_SIZE)}...`;
            
            await Promise.all(batch.map(async (resolver) => {
                const res = await measureOneResolver(resolver);
                results.push(res);
            }));
        }

        progress.textContent = "Sorting results by weighted Performance Score...";
        
        // Sort results: lowest weighted Performance Score first, failures at the bottom
        const sortedResults = [...results].sort((a, b) => {
            if (a.score === null && b.score === null) return 0;
            if (a.score === null) return 1;
            if (b.score === null) return -1;
            return a.score - b.score;
        });

        const fastest = sortedResults.find(r => r.score !== null);

        tbody.innerHTML = "";
        sortedResults.forEach((res, index) => {
            const resolver = res.resolver;
            const tr = document.createElement("tr");
            tr.id = `row-${resolver.id}`;
            
            const isFastest = fastest && fastest.resolver.id === resolver.id;
            if (isFastest) {
                tr.style.backgroundColor = "#e8f8f5";
            }
            
            const metaTags = [];
            if (resolver.country) metaTags.push(resolver.country);
            if (resolver.dnssec) metaTags.push("DNSSEC");
            if (resolver.no_logs) metaTags.push("No-Logs");
            if (resolver.no_filter) metaTags.push("Unfiltered");
            const metaTagsStr = metaTags.length > 0 ? `<br><small style="color:gray; font-size:11px;">[${metaTags.join(" | ")}]</small>` : "";
            
            const fastestBadge = isFastest ? ' <span style="background:#2ecc71; color:white; padding:2px 6px; font-size:11px; border-radius:3px; margin-left:5px; font-weight:bold;">FASTEST</span>' : '';

            const setupId = `setup-${resolver.id}`;
            const escapedUrl = resolver.url.replace(/'/g, "\\'");
            const escapedIp = (resolver.ip_address || "").replace(/'/g, "\\'");
            const ipGuide = resolver.ip_address 
                ? `<p style="margin:5px 0;"><strong>System DNS IP:</strong> <code>${resolver.ip_address}</code> <button class="copy-btn" id="copy-ip-${resolver.id}" onclick="copyText('${escapedIp}', 'copy-ip-${resolver.id}')">Copy</button></p>`
                : `<p style="margin:5px 0; color: gray;"><strong>System DNS IP:</strong> Not specified in stamp.</p>`;

            const corsHtml = !resolver.cors
                ? `<p style="margin:5px 0; color: #d35400;"><strong>CORS Status:</strong> ⚠️ No-CORS (measured via browser opaque mode)</p>`
                : `<p style="margin:5px 0; color: #27ae60;"><strong>CORS Status:</strong> ✅ Supports CORS (fully verified browser queries)</p>`;

            const guideHtml = `
                <div id="${setupId}" class="setup-details" style="display: none;">
                    <p style="margin:5px 0 10px 0; color: #7f8c8d; font-size:12px;">${resolver.description || 'No additional description provided.'}</p>
                    <p style="margin:5px 0;"><strong>Browser (DoH URL):</strong> <code>${resolver.url}</code> <button class="copy-btn" id="copy-url-${resolver.id}" onclick="copyText('${escapedUrl}', 'copy-url-${resolver.id}')">Copy</button></p>
                    ${ipGuide}
                    ${corsHtml}
                    <small style="color: #7f8c8d; display:block; margin-top:8px;">Enter the DoH URL in your browser's Secure DNS settings (e.g. Chrome/Firefox Settings -> Secure DNS) or use the IP in your system network settings.</small>
                </div>
            `;

            tr.innerHTML = `
                <td>
                    <strong>${resolver.name}</strong>${fastestBadge} 
                    <button class="setup-guide-btn" onclick="toggleSetup('${setupId}')">⚙️ Setup</button>
                    ${metaTagsStr}
                    ${guideHtml}
                </td>
                <td id="cached-${resolver.id}"></td>
                <td id="uncached-${resolver.id}"></td>
                <td id="score-${resolver.id}"></td>
                <td id="status-${resolver.id}" class="status"></td>
            `;
            tbody.appendChild(tr);

            const cachedEl = document.getElementById(`cached-${resolver.id}`);
            const uncachedEl = document.getElementById(`uncached-${resolver.id}`);
            const scoreEl = document.getElementById(`score-${resolver.id}`);
            const statusEl = document.getElementById(`status-${resolver.id}`);

            // Build per-query detail string for setup panel
            const cachedDetail = res.cachedTimes && res.cachedTimes.length > 0
                ? res.cachedTimes.map(t => t.toFixed(1)).join(", ") : "N/A";
            const uncachedDetail = res.uncachedTimes && res.uncachedTimes.length > 0
                ? res.uncachedTimes.map(t => t.toFixed(1)).join(", ") : "N/A";

            if (cachedEl) {
                cachedEl.innerHTML = res.cachedAvg !== null
                    ? `${res.cachedAvg.toFixed(1)} ms<br><small style="color:gray; font-size:11px;">[${cachedDetail}]</small>`
                    : "Fail";
            }
            if (uncachedEl) {
                uncachedEl.innerHTML = res.uncachedAvg !== null
                    ? `${res.uncachedAvg.toFixed(1)} ms<br><small style="color:gray; font-size:11px;">[${uncachedDetail}]</small>`
                    : "Fail";
            }
            if (scoreEl) {
                scoreEl.innerHTML = res.score !== null
                    ? `<strong>${res.score.toFixed(1)} ms</strong>`
                    : "Fail";
            }
            if (statusEl) {
                statusEl.textContent = res.statusText;
            }

            // Log each resolver's individual measurements to browser console
            console.log(`${resolver.name}: cached=[${cachedDetail}] uncached=[${uncachedDetail}] score=${res.score !== null ? res.score.toFixed(1) : 'N/A'}ms cors=${resolver.cors}`);

            // Telemetry (if opted in)
            if (optInBox.checked && res.cachedAvg !== null && res.uncachedAvg !== null) {
                console.log(`Telemetry: ${resolver.name} - Cached: ${res.cachedAvg.toFixed(1)}ms, Uncached: ${res.uncachedAvg.toFixed(1)}ms`);
            }
        });

        // Verification: two-tier trust architecture.
        // Tier 1: ALL CORS resolvers with valid DNS responses are inherently trusted
        // because we parsed their A record answers. They get "Verified (DNS)" immediately.
        // Tier 2: For no-CORS (opaque) resolvers, we poll Cloudflare GraphQL to detect
        // cheating. We limit GraphQL polling to top 10 opaque resolvers to protect API rate limits.
        const allValid = sortedResults.filter(r => r.score !== null);
        const allCors = allValid.filter(r => r.resolver.cors && r.statusText === "Success");
        const opaqueForVerification = allValid.filter(r => !r.resolver.cors || r.statusText !== "Success").slice(0, 10);

        // Auto-verify ALL CORS resolvers immediately (regardless of rank)
        allCors.forEach(res => {
            const statusEl = document.getElementById(`status-${res.resolver.id}`);
            if (statusEl) {
                statusEl.innerHTML = `<span style="color: #27ae60; font-weight: bold;">✅ Verified (DNS)</span> <br><small style="color: gray; font-size:10px;">(CORS response parsed)</small>`;
            }
        });

        if (opaqueForVerification.length > 0) {
            const corsCount = allCors.length;
            progress.innerHTML = `Measurements complete. CORS: ${corsCount} auto-verified. <strong>🔍 Verifying top ${opaqueForVerification.length} opaque resolvers...</strong>`;

            opaqueForVerification.forEach(res => {
                const statusEl = document.getElementById(`status-${res.resolver.id}`);
                if (statusEl) {
                    statusEl.innerHTML = `<span style="color: #d35400;">Verifying... 🔍</span> <br><small style="color: gray; font-size:10px;">(No-CORS)</small>`;
                }
            });

            // Verification polling with exponential backoff for opaque resolvers only
            const INITIAL_DELAY_MS = 10000;  // first poll delayed 10s
            const MAX_TOTAL_MS = 90000;       // 90s total budget
            const BACKOFF_SECS = [0, 8, 16, 32]; // intervals between successive polls
            const verifiedIds = new Set();
            let pollIdx = 0;
            const startTs = Date.now();

            await new Promise(r => setTimeout(r, INITIAL_DELAY_MS));

            while (true) {
                const remaining = opaqueForVerification.filter(res => !verifiedIds.has(res.resolver.id));
                if (remaining.length === 0) break;
                if (Date.now() - startTs >= MAX_TOTAL_MS) break;

                await Promise.all(remaining.map(async (res) => {
                    if (!res.domains || !res.domains[0]) return;
                    const firstDomain = res.domains[0];
                    try {
                        const verifyRes = await fetch(`${API_BASE}/dns/verify?domain=${firstDomain}`);
                        if (verifyRes.ok) {
                            const data = await verifyRes.json();
                            if (data.verified) {
                                verifiedIds.add(res.resolver.id);
                                const statusEl = document.getElementById(`status-${res.resolver.id}`);
                                if (statusEl) {
                                    statusEl.innerHTML = `<span style="color: #27ae60; font-weight: bold;">✅ Verified (Auth)</span> <br><small style="color: gray; font-size:10px;">(No-CORS, authoritative log match)</small>`;
                                }
                            }
                        }
                    } catch (e) {
                        console.error("Verification error for", res.resolver.name, e);
                    }
                }));

                const opaqueVerified = verifiedIds.size;
                progress.innerHTML = `Measurements complete. CORS: ${allCors.length} verified. <strong>Opaque: ${opaqueVerified}/${opaqueForVerification.length} verified</strong>`;

                const stillRemaining = opaqueForVerification.filter(res => !verifiedIds.has(res.resolver.id));
                if (stillRemaining.length === 0) break;

                const delay = (BACKOFF_SECS[Math.min(pollIdx, BACKOFF_SECS.length - 1)] || 32) * 1000;
                pollIdx++;
                if (Date.now() - startTs + delay >= MAX_TOTAL_MS) break;
                await new Promise(r => setTimeout(r, delay));
            }

            progress.innerHTML = `Measurements complete. <strong>Verification finished!</strong>`;

            // Mark opaque resolvers that failed verification
            opaqueForVerification.filter(res => !verifiedIds.has(res.resolver.id)).forEach(res => {
                const statusEl = document.getElementById(`status-${res.resolver.id}`);
                if (statusEl) {
                    statusEl.innerHTML = `<span style="color: #c0392b; font-weight: bold;">❌ Unverified</span> <br><small style="color: gray; font-size:10px;">(No-CORS, not in authoritative logs)</small>`;
                }
            });
        } else {
            progress.innerHTML = `Measurements complete. <strong>All resolvers auto-verified via CORS.</strong>`;
        }

    } catch (err) {
        console.error(err);
        progress.textContent = `Error: ${err.message}`;
    } finally {
        btn.disabled = false;
    }
}

btn.addEventListener("click", runMeasurements);

loadResolvers();

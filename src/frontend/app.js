import init, { measure_resolver } from './wasm/pkg/dns_resolver_recommender.js?v=1779109982';

let resolvers = [];

const API_BASE = "https://dns.diic-hpi.org/api";

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
            cors: r.url.includes("cloudflare-dns") || r.url.includes("dns.google"),
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

async function measureOneResolver(resolver, domainInfos) {
    const cachedEl = document.getElementById(`cached-${resolver.id}`);
    const uncachedEl = document.getElementById(`uncached-${resolver.id}`);
    const scoreEl = document.getElementById(`score-${resolver.id}`);
    const statusEl = document.getElementById(`status-${resolver.id}`);
    
    if (statusEl) statusEl.textContent = "Measuring...";
    
    try {
        // 1. Connection Warm-up (TLS Establishment)
        try {
            await measure_resolver(resolver.url, "example.com", resolver.cors);
        } catch (e) {
            // Proceed even if warm-up fails
        }
        
        // 2. Cached Measurement (Average of 3 queries to example.com)
        const cachedTimes = [];
        let cachedStatus = "ok";
        for (let j = 0; j < 3; j++) {
            try {
                const res = await measure_resolver(resolver.url, "example.com", resolver.cors);
                if (res.status === "ok" || res.status.includes("NOERROR") || res.status.includes("opaque")) {
                    cachedTimes.push(res.latency_ms);
                } else {
                    cachedStatus = res.status;
                }
            } catch (e) {
                cachedStatus = "Fetch Error (CORS/Network)";
            }
        }
        
        const cachedAvg = cachedTimes.length > 0 
            ? cachedTimes.reduce((a, b) => a + b, 0) / cachedTimes.length 
            : null;
            
        if (cachedEl) {
            cachedEl.innerHTML = cachedAvg !== null
                ? `${cachedAvg.toFixed(1)} ms<br><small style="color:gray; font-size:11px;">[${cachedTimes.map(t => t.toFixed(1)).join(", ")}]</small>`
                : "Fail";
        }

        // 3. Uncached Measurement (Average of 3 queries to globally generated unique domains)
        const uncachedTimes = [];
        let uncachedStatus = "ok";
        
        for (let j = 0; j < 3; j++) {
            const domainInfo = domainInfos[j];
            if (domainInfo) {
                try {
                    const res = await measure_resolver(resolver.url, domainInfo.domain, resolver.cors);
                    if (res.status === "ok" || res.status.includes("NOERROR") || res.status.includes("opaque")) {
                        uncachedTimes.push(res.latency_ms);
                    } else {
                        uncachedStatus = res.status;
                    }
                } catch (e) {
                    uncachedStatus = "Measurement Error";
                }
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
            statusText: score !== null ? (resolver.cors ? "Success" : "Opaque (Unverified)") : uncachedStatus
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
            statusText: "Error"
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
        
        progress.textContent = "Preparing 3 global uncached domains (takes ~30s for DNS propagation)...";
        const domainInfos = [];
        for (let j = 0; j < 3; j++) {
            try {
                const rotateRes = await fetch(`${API_BASE}/dns/rotate`, { method: "POST" });
                if (!rotateRes.ok) throw new Error("Rotate failed");
                domainInfos.push(await rotateRes.json());
            } catch (e) {
                console.error(e);
            }
        }
        
        if (domainInfos.length < 3) {
            progress.textContent = "Error: Failed to prepare global uncached domains.";
            btn.disabled = false;
            return;
        }
        
        // Wait 30 seconds for Cloudflare anycast propagation
        await new Promise(r => setTimeout(r, 30000));

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

            const guideHtml = `
                <div id="${setupId}" class="setup-details" style="display: none;">
                    <p style="margin:5px 0 10px 0; color: #7f8c8d; font-size:12px;">${resolver.description || 'No additional description provided.'}</p>
                    <p style="margin:5px 0;"><strong>Browser (DoH URL):</strong> <code>${resolver.url}</code> <button class="copy-btn" id="copy-url-${resolver.id}" onclick="copyText('${escapedUrl}', 'copy-url-${resolver.id}')">Copy</button></p>
                    ${ipGuide}
                    <small style="color: #7f8c8d; display:block; margin-top:8px;">Enter the DoH URL in your browser's Secure DNS settings (e.g. Chrome/Firefox Settings -> Secure DNS) or use the IP in your system network settings.</small>
                </div>
            `;

            tr.innerHTML = `
                <td>
                    <strong>${resolver.name}</strong> 
                    <button class="setup-guide-btn" onclick="toggleSetup('${setupId}')">⚙️ Setup</button>
                    ${!resolver.cors ? '<span style="color:orange; cursor:help;" title="Missing CORS headers on server. Results are opaque (unverified) and may not reflect actual successful DNS resolution.">⚠️ (No-CORS)</span>' : ''}
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

        const BATCH_SIZE = 10;
        const results = [];
        for (let i = 0; i < resolvers.length; i += BATCH_SIZE) {
            const batch = resolvers.slice(i, i + BATCH_SIZE);
            progress.textContent = `Measuring batch ${Math.floor(i / BATCH_SIZE) + 1} of ${Math.ceil(resolvers.length / BATCH_SIZE)}...`;
            
            await Promise.all(batch.map(async (resolver) => {
                const res = await measureOneResolver(resolver, domainInfos);
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

            const guideHtml = `
                <div id="${setupId}" class="setup-details" style="display: none;">
                    <p style="margin:5px 0 10px 0; color: #7f8c8d; font-size:12px;">${resolver.description || 'No additional description provided.'}</p>
                    <p style="margin:5px 0;"><strong>Browser (DoH URL):</strong> <code>${resolver.url}</code> <button class="copy-btn" id="copy-url-${resolver.id}" onclick="copyText('${escapedUrl}', 'copy-url-${resolver.id}')">Copy</button></p>
                    ${ipGuide}
                    <small style="color: #7f8c8d; display:block; margin-top:8px;">Enter the DoH URL in your browser's Secure DNS settings (e.g. Chrome/Firefox Settings -> Secure DNS) or use the IP in your system network settings.</small>
                </div>
            `;

            tr.innerHTML = `
                <td>
                    <strong>${resolver.name}</strong>${fastestBadge} 
                    <button class="setup-guide-btn" onclick="toggleSetup('${setupId}')">⚙️ Setup</button>
                    ${!resolver.cors ? '<span style="color:orange; cursor:help;" title="Missing CORS headers on server. Results are opaque (unverified) and may not reflect actual successful DNS resolution.">⚠️ (No-CORS)</span>' : ''}
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
            
            if (cachedEl) {
                cachedEl.innerHTML = res.cachedAvg !== null
                    ? `${res.cachedAvg.toFixed(1)} ms`
                    : "Fail";
            }
            if (uncachedEl) {
                uncachedEl.innerHTML = res.uncachedAvg !== null
                    ? `${res.uncachedAvg.toFixed(1)} ms`
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
            
            // Telemetry (if opted in)
            if (optInBox.checked && res.cachedAvg !== null && res.uncachedAvg !== null) {
                // To be implemented in Phase 8
                console.log(`Telemetry: ${resolver.name} - Cached: ${res.cachedAvg.toFixed(1)}ms, Uncached: ${res.uncachedAvg.toFixed(1)}ms`);
            }
        });

        progress.textContent = "Measurements complete. See results below.";

        // Cleanup the 3 global subdomains in the background
        domainInfos.forEach(domainInfo => {
            if (domainInfo) {
                fetch(`${API_BASE}/dns/${domainInfo.record_id}`, { method: "DELETE" }).catch(console.error);
            }
        });

    } catch (err) {
        console.error(err);
        progress.textContent = `Error: ${err.message}`;
    } finally {
        btn.disabled = false;
    }
}

btn.addEventListener("click", runMeasurements);

loadResolvers();

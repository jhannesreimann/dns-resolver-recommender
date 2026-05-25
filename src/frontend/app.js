import init, { measure_resolver } from './wasm/pkg/dns_resolver_recommender.js?v=1779109982';

const RESOLVERS = [
    { name: "Cloudflare", url: "https://cloudflare-dns.com/dns-query", cors: true },
    { name: "Google", url: "https://dns.google/dns-query", cors: true },
    { name: "CleanBrowsing", url: "https://doh.cleanbrowsing.org/doh/family-filter/", cors: true },
    { name: "Quad9", url: "https://dns.quad9.net/dns-query", cors: false },
    { name: "AdGuard", url: "https://dns.adguard-dns.com/dns-query", cors: false },
    { name: "NextDNS", url: "https://dns.nextdns.io/dns-query", cors: false }
];

const API_BASE = "https://dns.diic-hpi.org/api";

const btn = document.getElementById("start-btn");
const progress = document.getElementById("progress");
const table = document.getElementById("results-table");
const tbody = document.getElementById("results-body");
const optInBox = document.getElementById("opt-in-telemetry");

async function runMeasurements() {
    btn.disabled = true;
    tbody.innerHTML = "";
    table.style.display = "table";
    
    try {
        await init({ module_or_path: './wasm/pkg/dns_resolver_recommender_bg.wasm?v=' + Date.now() }); // Initialize Wasm with cache-busting
        
        progress.textContent = "Preparing uncached domains (takes ~30s for DNS propagation)...";
        const domainInfos = [];
        for (let i = 0; i < RESOLVERS.length; i++) {
            const resolverDomains = [];
            for (let j = 0; j < 3; j++) {
                try {
                    const rotateRes = await fetch(`${API_BASE}/dns/rotate`, { method: "POST" });
                    if (!rotateRes.ok) throw new Error("Rotate failed");
                    resolverDomains.push(await rotateRes.json());
                } catch (e) {
                    console.error(e);
                    resolverDomains.push(null);
                }
            }
            domainInfos.push(resolverDomains);
        }
        
        // Wait 30 seconds for Cloudflare anycast propagation
        await new Promise(r => setTimeout(r, 30000));

        for (let i = 0; i < RESOLVERS.length; i++) {
            const resolver = RESOLVERS[i];
            progress.textContent = `Measuring ${resolver.name}...`;
            
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td><strong>${resolver.name}</strong> ${!resolver.cors ? '<span style="color:orange; cursor:help;" title="Missing CORS headers on server. Results are opaque (unverified) and may not reflect actual successful DNS resolution.">⚠️ (No-CORS)</span>' : ''}</td>
                <td id="cached-${resolver.name}">...</td>
                <td id="uncached-${resolver.name}">...</td>
                <td id="status-${resolver.name}" class="status">...</td>
            `;
            tbody.appendChild(tr);

            // 1. Cached Measurement (Median of 3 queries to example.com)
            let cachedTimes = [];
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
                    console.error(`Cached measurement failed for ${resolver.name}:`, e);
                    cachedStatus = "Fetch Error (CORS/Network)";
                }
            }
            
            const cachedMs = cachedTimes.length > 0 
                ? cachedTimes.sort((a,b) => a-b)[Math.floor(cachedTimes.length/2)] 
                : null;
            
            document.getElementById(`cached-${resolver.name}`).innerHTML = 
                cachedMs ? `${cachedMs.toFixed(1)} ms<br><small style="color:gray; font-size:11px;">[${cachedTimes.map(t => t.toFixed(1)).join(", ")}]</small>` : "Fail";

            // 2. Uncached Measurement (UUID via our backend, median of 3)
            let uncachedTimes = [];
            let uncachedStatus = "ok";
            const resolverDomains = domainInfos[i] || [];
            
            for (let j = 0; j < 3; j++) {
                const domainInfo = resolverDomains[j];
                if (domainInfo) {
                    try {
                        const unRes = await measure_resolver(resolver.url, domainInfo.domain, resolver.cors);
                        if (unRes.status === "ok" || unRes.status.includes("NOERROR") || unRes.status.includes("opaque")) {
                            uncachedTimes.push(unRes.latency_ms);
                        } else {
                            uncachedStatus = unRes.status;
                        }
                    } catch (e) {
                        console.error(e);
                        uncachedStatus = "Measurement Error";
                    } finally {
                        // Cleanup UUID
                        fetch(`${API_BASE}/dns/${domainInfo.record_id}`, { method: "DELETE" }).catch(console.error);
                    }
                }
            }
            
            const uncachedMs = uncachedTimes.length > 0 
                ? uncachedTimes.sort((a,b) => a-b)[Math.floor(uncachedTimes.length/2)] 
                : null;

            if (uncachedMs) {
                document.getElementById(`uncached-${resolver.name}`).innerHTML = `${uncachedMs.toFixed(1)} ms<br><small style="color:gray; font-size:11px;">[${uncachedTimes.map(t => t.toFixed(1)).join(", ")}]</small>`;
                document.getElementById(`status-${resolver.name}`).textContent = resolver.cors ? "Success" : "Opaque (Unverified)";
            } else {
                document.getElementById(`uncached-${resolver.name}`).textContent = "Fail";
                document.getElementById(`status-${resolver.name}`).textContent = uncachedStatus;
            }
            
            // 3. Telemetry (if opted in)
            if (optInBox.checked && cachedMs !== null && uncachedMs !== null) {
                // To be implemented in Phase 7
                console.log(`Telemetry: ${resolver.name} - Cached: ${cachedMs.toFixed(1)}ms, Uncached: ${uncachedMs.toFixed(1)}ms`);
            }
        }
        progress.textContent = "Measurements complete. See results below.";
    } catch (err) {
        console.error(err);
        progress.textContent = `Error: ${err.message}`;
    } finally {
        btn.disabled = false;
    }
}

btn.addEventListener("click", runMeasurements);

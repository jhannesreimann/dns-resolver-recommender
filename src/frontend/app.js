import init, { measure_resolver } from './wasm/pkg/dns_resolver_recommender.js';

const RESOLVERS = [
    { name: "Cloudflare", url: "https://cloudflare-dns.com/dns-query" },
    { name: "Google", url: "https://dns.google/dns-query" },
    { name: "Quad9", url: "https://dns11.quad9.net/dns-query" },
    { name: "AdGuard", url: "https://dns.adguard-dns.com/dns-query" },
    { name: "NextDNS", url: "https://dns.nextdns.io/dns-query" }
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
        await init(); // Initialize Wasm
        
        for (const resolver of RESOLVERS) {
            progress.textContent = `Measuring ${resolver.name}...`;
            
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td><strong>${resolver.name}</strong></td>
                <td id="cached-${resolver.name}">...</td>
                <td id="uncached-${resolver.name}">...</td>
                <td id="status-${resolver.name}" class="status">...</td>
            `;
            tbody.appendChild(tr);

            // 1. Cached Measurement (Median of 3 queries to example.com)
            let cachedTimes = [];
            let cachedStatus = "ok";
            for (let i = 0; i < 3; i++) {
                // Randomize domain slightly to prevent browser-level DNS caching over multiple visits
                const res = await measure_resolver(resolver.url, `example-${Date.now()}.com`);
                if (res.status === "ok" || res.status.includes("NOERROR")) {
                    cachedTimes.push(res.latency_ms);
                } else {
                    cachedStatus = res.status;
                }
            }
            
            const cachedMs = cachedTimes.length > 0 
                ? cachedTimes.sort((a,b) => a-b)[Math.floor(cachedTimes.length/2)] 
                : null;
            
            document.getElementById(`cached-${resolver.name}`).textContent = 
                cachedMs ? cachedMs.toFixed(1) : "Fail";

            // 2. Uncached Measurement (UUID via our backend)
            let uncachedMs = null;
            let recordId = null;
            try {
                const rotateRes = await fetch(`${API_BASE}/dns/rotate`, { method: "POST" });
                if (!rotateRes.ok) throw new Error("Rotate failed");
                const { domain, record_id } = await rotateRes.json();
                recordId = record_id;

                const unRes = await measure_resolver(resolver.url, domain);
                if (unRes.status === "ok" || unRes.status.includes("NOERROR")) {
                    uncachedMs = unRes.latency_ms;
                    document.getElementById(`uncached-${resolver.name}`).textContent = uncachedMs.toFixed(1);
                    document.getElementById(`status-${resolver.name}`).textContent = "Success";
                } else {
                    document.getElementById(`uncached-${resolver.name}`).textContent = "Fail";
                    document.getElementById(`status-${resolver.name}`).textContent = unRes.status;
                }
            } catch (e) {
                console.error(e);
                document.getElementById(`uncached-${resolver.name}`).textContent = "Error";
                document.getElementById(`status-${resolver.name}`).textContent = "Backend Error";
            } finally {
                // Cleanup UUID
                if (recordId) {
                    fetch(`${API_BASE}/dns/${recordId}`, { method: "DELETE" }).catch(console.error);
                }
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

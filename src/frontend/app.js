import init, { measure_resolver } from './wasm/pkg/dns_resolver_recommender.js?v=1779109982';

let resolvers = [];

const API_BASE = "https://dns.diic-hpi.org/api";

const btn = document.getElementById("start-btn");
const progress = document.getElementById("progress");
const table = document.getElementById("results-table");
const tbody = document.getElementById("results-body");
const optInBox = document.getElementById("opt-in-telemetry");

async function loadResolvers() {
    try {
        const response = await fetch(`${API_BASE}/resolvers`);
        if (!response.ok) throw new Error("Failed to load resolvers list");
        const list = await response.json();
        resolvers = list.map(r => ({
            id: r.id,
            name: r.name,
            url: r.url,
            cors: r.url.includes("cloudflare-dns") || r.url.includes("dns.google") || r.url.includes("cleanbrowsing"),
            dnssec: r.dnssec,
            no_logs: r.no_logs,
            no_filter: r.no_filter,
            country: r.country,
            description: r.description
        }));
    } catch (e) {
        console.error(e);
        resolvers = [
            { id: "cloudflare", name: "Cloudflare", url: "https://cloudflare-dns.com/dns-query", cors: true, dnssec: true, no_logs: true, no_filter: true, country: "US", description: "Cloudflare public DNS" },
            { id: "google", name: "Google", url: "https://dns.google/dns-query", cors: true, dnssec: true, no_logs: false, no_filter: true, country: "US", description: "Google public DNS" },
            { id: "cleanbrowsing", name: "CleanBrowsing", url: "https://doh.cleanbrowsing.org/doh/family-filter/", cors: true, dnssec: true, no_logs: true, no_filter: false, country: "US", description: "CleanBrowsing filtering" },
            { id: "quad9", name: "Quad9", url: "https://dns.quad9.net/dns-query", cors: false, dnssec: true, no_logs: true, no_filter: false, country: "US", description: "Quad9 filtering" }
        ];
    }
    renderResolverCheckboxes();
}

function renderResolverCheckboxes() {
    const container = document.getElementById("resolver-checkboxes");
    if (!container) return;
    container.innerHTML = "";
    
    const popular = ["cloudflare", "google", "cleanbrowsing", "quad9"];
    
    resolvers.forEach(r => {
        const div = document.createElement("div");
        div.className = "resolver-item";
        div.setAttribute("data-name", r.name.toLowerCase());
        div.setAttribute("data-country", (r.country || "").toLowerCase());
        
        const isChecked = popular.includes(r.id) ? "checked" : "";
        const countryTag = r.country ? `[${r.country}]` : "";
        const tags = [];
        if (r.dnssec) tags.push("SEC");
        if (r.no_logs) tags.push("LOGS_OFF");
        const tagsStr = tags.length > 0 ? `(${tags.join(",")})` : "";
        
        div.innerHTML = `
            <label style="display: flex; align-items: flex-start; gap: 6px; cursor: pointer; user-select: none;">
                <input type="checkbox" class="resolver-checkbox" value="${r.id}" ${isChecked} style="margin-top: 3px;">
                <div>
                    <strong>${r.name}</strong> <small style="color: gray;">${countryTag} ${tagsStr}</small>
                </div>
            </label>
        `;
        container.appendChild(div);
    });
}

const searchInput = document.getElementById("resolver-search");
if (searchInput) {
    searchInput.addEventListener("input", (e) => {
        const q = e.target.value.toLowerCase();
        const items = document.querySelectorAll(".resolver-item");
        items.forEach(item => {
            const name = item.getAttribute("data-name");
            const country = item.getAttribute("data-country");
            if (name.includes(q) || country.includes(q)) {
                item.style.display = "block";
            } else {
                item.style.display = "none";
            }
        });
    });
}

const selectAllBtn = document.getElementById("select-all-btn");
if (selectAllBtn) {
    selectAllBtn.addEventListener("click", () => {
        document.querySelectorAll(".resolver-checkbox").forEach(cb => {
            if (cb.parentElement.parentElement.style.display !== "none") {
                cb.checked = true;
            }
        });
    });
}

const selectNoneBtn = document.getElementById("select-none-btn");
if (selectNoneBtn) {
    selectNoneBtn.addEventListener("click", () => {
        document.querySelectorAll(".resolver-checkbox").forEach(cb => {
            cb.checked = false;
        });
    });
}

async function runMeasurements() {
    const activeResolvers = [];
    document.querySelectorAll(".resolver-checkbox:checked").forEach(cb => {
        const r = resolvers.find(res => res.id === cb.value);
        if (r) activeResolvers.push(r);
    });
    
    if (activeResolvers.length === 0) {
        progress.textContent = "Please select at least one resolver.";
        return;
    }

    btn.disabled = true;
    tbody.innerHTML = "";
    table.style.display = "table";
    
    try {
        await init({ module_or_path: './wasm/pkg/dns_resolver_recommender_bg.wasm?v=' + Date.now() }); // Initialize Wasm with cache-busting
        
        progress.textContent = "Preparing uncached domains (takes ~30s for DNS propagation)...";
        const domainInfos = [];
        for (let i = 0; i < activeResolvers.length; i++) {
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

        for (let i = 0; i < activeResolvers.length; i++) {
            const resolver = activeResolvers[i];
            progress.textContent = `Measuring ${resolver.name}...`;
            
            const tr = document.createElement("tr");
            const metaTags = [];
            if (resolver.country) metaTags.push(resolver.country);
            if (resolver.dnssec) metaTags.push("DNSSEC");
            if (resolver.no_logs) metaTags.push("No-Logs");
            if (resolver.no_filter) metaTags.push("Unfiltered");
            const metaTagsStr = metaTags.length > 0 ? `<br><small style="color:gray; font-size:11px;">[${metaTags.join(" | ")}]</small>` : "";

            tr.innerHTML = `
                <td><strong>${resolver.name}</strong> ${!resolver.cors ? '<span style="color:orange; cursor:help;" title="Missing CORS headers on server. Results are opaque (unverified) and may not reflect actual successful DNS resolution.">⚠️ (No-CORS)</span>' : ''}${metaTagsStr}</td>
                <td id="cached-${resolver.id}">...</td>
                <td id="uncached-${resolver.id}">...</td>
                <td id="status-${resolver.id}" class="status">...</td>
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
            
            document.getElementById(`cached-${resolver.id}`).innerHTML = 
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
                document.getElementById(`uncached-${resolver.id}`).innerHTML = `${uncachedMs.toFixed(1)} ms<br><small style="color:gray; font-size:11px;">[${uncachedTimes.map(t => t.toFixed(1)).join(", ")}]</small>`;
                document.getElementById(`status-${resolver.id}`).textContent = resolver.cors ? "Success" : "Opaque (Unverified)";
            } else {
                document.getElementById(`uncached-${resolver.id}`).textContent = "Fail";
                document.getElementById(`status-${resolver.id}`).textContent = uncachedStatus;
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

loadResolvers();

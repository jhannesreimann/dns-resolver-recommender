import init from "./pkg/dns_resolver_recommender.js";

const runWasm = async () => {
    // Instantiate our wasm module
    const recommender = await init("./pkg/dns_resolver_recommender_bg.wasm");

    const addResult = recommender.add(2, 3);

    document.body.textContent = `Result: ${addResult}`;
};

runWasm();

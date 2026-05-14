use hickory_proto::op::{Message, MessageType, Query, OpCode};
use hickory_proto::rr::{Name, RecordType};
use js_sys::Uint8Array;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;
use web_sys::{Request, RequestInit, RequestMode, Response};

#[wasm_bindgen]
pub struct MeasurementResult {
    pub latency_ms: f64,
    status: String,
}

#[wasm_bindgen]
impl MeasurementResult {
    #[wasm_bindgen(getter)]
    pub fn status(&self) -> String {
        self.status.clone()
    }
}

/// Measures a single DoH request.
/// Returns latency in ms and "ok" if NOERROR and an A record was returned.
#[wasm_bindgen]
pub async fn measure_resolver(
    doh_url: String,
    domain: String,
) -> Result<MeasurementResult, JsValue> {
    // 1. Build the DNS Query
    let txid: u16 = rand::random();
    let mut msg = Message::new(txid, MessageType::Query, OpCode::Query);
    msg.metadata.recursion_desired = true;

    let name = Name::from_utf8(domain.clone())
        .map_err(|e| JsValue::from_str(&format!("Invalid domain: {}", e)))?;
    let query = Query::query(name, RecordType::A);
    msg.add_query(query);

    let query_bytes = msg.to_vec()
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize query: {}", e)))?;

    // Base64URL encode without padding
    let base64_str = base64_url::encode(&query_bytes);
    
    let mut url = doh_url.clone();
    if url.contains('?') {
        url = format!("{}&dns={}", url, base64_str);
    } else {
        url = format!("{}?dns={}", url, base64_str);
    }

    let mut opts = RequestInit::new();
    opts.set_method("GET");
    opts.set_mode(RequestMode::Cors);
    opts.set_credentials(web_sys::RequestCredentials::Omit);

    let request = Request::new_with_str_and_init(&url, &opts)?;
    request.headers().set("Accept", "application/dns-message")?;
    // Add cache bursting to prevent the browser from caching the OPTIONS or GET request
    request.headers().set("Cache-Control", "no-cache")?;

    let window = web_sys::window().ok_or("No window available")?;
    
    // 3. Measure Roundtrip
    let performance = window.performance().ok_or("No performance API available")?;
    let start = performance.now();

    let resp_value = JsFuture::from(window.fetch_with_request(&request)).await?;
    let resp: Response = resp_value.dyn_into()?;

    if !resp.ok() {
        return Ok(MeasurementResult {
            latency_ms: performance.now() - start,
            status: format!("HTTP Error: {}", resp.status()),
        });
    }

    // 4. Parse the Response
    let buf_value = JsFuture::from(resp.array_buffer()?).await?;
    let end = performance.now();
    let latency = end - start;

    let buf = js_sys::Uint8Array::new(&buf_value);
    let mut resp_bytes = vec![0; buf.length() as usize];
    buf.copy_to(&mut resp_bytes);

    let parsed_msg = Message::from_vec(&resp_bytes)
        .map_err(|e| JsValue::from_str(&format!("Failed to parse response: {}", e)))?;

    let response_code = parsed_msg.metadata.response_code;
    let status = if response_code == hickory_proto::op::ResponseCode::NoError {
        if parsed_msg.answers.is_empty() {
            "NOERROR (Empty)".to_string()
        } else {
            "ok".to_string()
        }
    } else {
        response_code.to_string()
    };

    Ok(MeasurementResult {
        latency_ms: latency,
        status,
    })
}

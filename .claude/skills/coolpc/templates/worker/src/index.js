// 原價屋估價頁代理：抓 https://www.coolpc.com.tw/evaluate.php (Big5)，原樣轉給 GitHub Pages 的估價網頁，
// 補上 CORS header，並在 Cloudflare 邊緣快取 CACHE_TTL 秒 (原價屋本身沒有 CORS，瀏覽器不能直接抓)。
// 解碼與解析都在瀏覽器端做 (docs/coolpc-live.js)，Worker 只負責搬運，不碰內容。
const COOLPC = "https://www.coolpc.com.tw/evaluate.php";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const allow = (env.ALLOW_ORIGINS || "*").split(",").map(s => s.trim()).filter(Boolean);
    const acao = allow.includes("*") ? "*" : allow.includes(origin) ? origin : allow[0];
    const cors = {
      "Access-Control-Allow-Origin": acao,
      "Access-Control-Expose-Headers": "X-Fetched-At, X-Cache",
      "Vary": "Origin",
    };
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { ...cors, "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS", "Access-Control-Max-Age": "86400" } });
    }
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method Not Allowed", { status: 405, headers: cors });
    if (url.pathname !== "/" && url.pathname !== "/evaluate.php") return new Response("Not Found", { status: 404, headers: cors });

    const ttl = Math.max(60, parseInt(env.CACHE_TTL || "300", 10) || 300);
    // 固定 cache key：忽略 query string，前端加 ?t= 防瀏覽器快取也不會打穿邊緣快取
    // (Cache API 只在自訂網域上有效，*.workers.dev 不會快取)
    const cache = caches.default;
    const key = new Request(url.origin + "/evaluate.php", { method: "GET" });
    let res = await cache.match(key);
    const hit = !!res;
    if (!res) {
      let up;
      try {
        up = await fetch(COOLPC, { headers: { "User-Agent": UA, "Accept-Language": "zh-TW,zh;q=0.9" } });
      } catch (e) {
        return new Response("upstream unreachable: " + e.message, { status: 502, headers: cors });
      }
      if (!up.ok) return new Response("upstream " + up.status, { status: 502, headers: cors });
      const body = await up.arrayBuffer();
      // 內容檢查：估價頁一定有報價日期 <font id=Mdy> 與 Big5 的「共有商品」(A6 40 A6 B3 B0 D3 AB 7E)
      const bytes = new Uint8Array(body);
      const ascii = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, 200000)));
      if (bytes.length < 100000 || !ascii.includes("id=Mdy") || !hasBytes(bytes, [0xa6, 0x40, 0xa6, 0xb3, 0xb0, 0xd3, 0xab, 0x7e])) {
        return new Response("upstream content does not look like the quote page", { status: 502, headers: cors });
      }
      res = new Response(body, {
        headers: {
          "Content-Type": "text/html; charset=Big5",
          "Cache-Control": "public, max-age=" + ttl,   // 給邊緣快取用；回給瀏覽器時會改成 no-store
          "X-Fetched-At": new Date().toISOString(),
        },
      });
      ctx.waitUntil(cache.put(key, res.clone()));
    }
    const h = new Headers(res.headers);
    for (const [k, v] of Object.entries(cors)) h.set(k, v);
    h.set("Cache-Control", "no-store");
    h.set("X-Cache", hit ? "HIT" : "MISS");
    return new Response(request.method === "HEAD" ? null : res.body, { status: 200, headers: h });
  },
};

function hasBytes(buf, pat) {
  outer: for (let i = 0, n = buf.length - pat.length; i <= n; i++) {
    for (let j = 0; j < pat.length; j++) if (buf[i + j] !== pat[j]) continue outer;
    return true;
  }
  return false;
}

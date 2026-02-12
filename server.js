import "dotenv/config";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { ethers } from "ethers";

const PORT = Number(process.env.PORT || 5173);
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY;

const SEPOLIA_CHAIN_ID = 11155111;
const ETHERSCAN_TX_BASE = "https://sepolia.etherscan.io/tx/"; // [web:169]

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type });
  res.end(body);
}

function json(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(data));
}

function checksumAddress(a) {
  try { return ethers.getAddress(a); } catch { return null; }
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/") {
    const html = await readFile(new URL("./index.html", import.meta.url));
    return send(res, 200, html, "text/html; charset=utf-8");
  }

  // GET /api/txs?address=0x...
  if (req.method === "GET" && url.pathname === "/api/txs") {
    if (!ETHERSCAN_API_KEY) return json(res, 500, { error: "Missing ETHERSCAN_API_KEY" });

    const address = checksumAddress(url.searchParams.get("address"));
    if (!address) return json(res, 400, { error: "Invalid address" });

    const api = new URL("https://api.etherscan.io/v2/api");
    api.searchParams.set("chainid", String(SEPOLIA_CHAIN_ID));
    api.searchParams.set("module", "account");
    api.searchParams.set("action", "txlist"); // Etherscan txlist [page:0]
    api.searchParams.set("address", address);
    api.searchParams.set("page", "1");
    api.searchParams.set("offset", "10");
    api.searchParams.set("sort", "desc");
    api.searchParams.set("apikey", ETHERSCAN_API_KEY);

    try {
      const r = await fetch(api);
      const data = await r.json();

      if (data.status !== "1") {
        return json(res, 502, { error: "Etherscan error", details: data });
      }

      const txs = (data.result || []).map((t) => {
        const ts = Number(t.timeStamp);
        const status = (t.isError === "1" || t.txreceipt_status === "0") ? "failed" : "success";

        const valueWei = t.value || "0";
        let valueEth = "0";
        try { valueEth = ethers.formatEther(BigInt(valueWei)); } catch {}

        return {
          // keep ALL original fields from Etherscan (strings)
          ...t, // includes from/to/hash/value/gas/gasPrice/input/confirmations/etc. [page:0]

          // add a few computed fields for UI
          status,
          timestamp: ts,
          dateIso: Number.isFinite(ts) ? new Date(ts * 1000).toISOString() : null,
          valueWei,
          valueEth,

          explorerUrl: ETHERSCAN_TX_BASE + t.hash, // [web:169]
        };
      });

      return json(res, 200, { address, chainId: SEPOLIA_CHAIN_ID, txs });
    } catch (e) {
      return json(res, 500, { error: e.message || "Tx fetch error" });
    }
  }

  send(res, 404, "Not found");
}).listen(PORT, () => console.log(`http://localhost:${PORT}`));

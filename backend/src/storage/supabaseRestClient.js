export function createSupabaseRestClient(options = {}) {
  const url = normalizeUrl(options.url);
  const key = options.serviceRoleKey ?? options.key;

  if (!url || !key) {
    return null;
  }

  async function request(path, options = {}) {
    const response = await fetch(`${url}/rest/v1${path}`, {
      method: options.method ?? "GET",
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        ...(options.headers ?? {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    const payload = await response.text();
    const data = payload ? JSON.parse(payload) : null;
    if (!response.ok) {
      const error = new Error(data?.message ?? `Supabase request failed: ${response.status}`);
      error.statusCode = response.status;
      throw error;
    }
    return data;
  }

  return {
    upsert(table, rows, options = {}) {
      const items = Array.isArray(rows) ? rows : [rows];
      const conflict = options.onConflict ? `?on_conflict=${encodeURIComponent(options.onConflict)}` : "";
      return request(`/${table}${conflict}`, {
        method: "POST",
        headers: {
          Prefer: "resolution=merge-duplicates,return=minimal"
        },
        body: items
      });
    },

    select(table, query = "") {
      return request(`/${table}${query}`);
    }
  };
}

function normalizeUrl(url) {
  return String(url ?? "").replace(/\/+$/, "");
}

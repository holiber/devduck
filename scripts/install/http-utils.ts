import http from 'http';
import https from 'https';
import { URL } from 'url';

export type HttpRequestResult = {
  success: boolean;
  statusCode: number | null;
  error: string | null;
  body: string | null;
  timeout?: boolean;
};

/**
 * Make HTTP request (Node http/https) with a fixed timeout.
 *
 * Note: Semantics intentionally match legacy installer behavior:
 * treat 2xx/3xx/4xx (except 404) as "reachable".
 */
export function makeHttpRequest(
  method: string,
  url: string,
  headers: Record<string, string> = {}
): Promise<HttpRequestResult> {
  return new Promise((resolve) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method,
      headers,
      timeout: 10_000
    };

    const req = httpModule.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        const statusCode = res.statusCode ?? null;
        const isSuccess =
          statusCode !== null && statusCode >= 200 && statusCode < 500 && statusCode !== 404;

        resolve({
          success: isSuccess,
          statusCode,
          error: null,
          body: data
        });
      });
    });

    req.on('error', (error) => {
      resolve({
        success: false,
        statusCode: null,
        error: error.message,
        body: null
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        success: false,
        statusCode: null,
        error: 'Request timeout',
        body: null,
        timeout: true
      });
    });

    req.end();
  });
}



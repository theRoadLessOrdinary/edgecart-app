<?php
/**
 * EdgeCart License — domain-bound signature verification.
 *
 * Public key cryptography (RSA-SHA256).  The private key lives only on the
 * edgecart.com signing server.  The public key below can only verify
 * signatures — it cannot create them.
 *
 * Subject strings:
 *   Core:    "{domain}"                  e.g. "theroadlessordinary.com"
 *   Plugin:  "{plugin_code}:{domain}"    e.g. "taxjar:theroadlessordinary.com"
 */
class License {

    private const PUBLIC_KEY = <<<PEM
-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxpCenE3As8d0N+MiskWt
/tn4l/LG64JOGlan+CkplNNCG2y0JqsIPig+7hH/S0a4+GaKDx6qrFBfm5liMPay
wV/uSasrqMVhmLZFed7X0hvbjo5CPlTB9sRQkph7ycASvPR0Y8VDhhwbr24MEwOP
K4USDz0IwpopiMTDjkwOHSKxaB7yMZBUgLniGMOVTT9UgOdb2YrJckYDWMfRGmoW
VYHkvjFd1eiUyKLeOoUCl9Be4Pn/Vx8FybLrcUe1TOBY3wTBc6RNFmq4oEy6XTkV
+zl3ZucO7HesFXF+XkOmg2Wn8SlEV8Wic+/SqPI/UPU02byhpJos2vQfp+S6R0Lf
bwIDAQAB
-----END PUBLIC KEY-----
PEM;

    // ── Public API ─────────────────────────────────────────────────────────────

    /**
     * Verify a signature against a subject string.
     * Returns true if valid, or if running in a dev context (CLI).
     */
    public static function verify(string $subject, string $signature_b64): bool {
        if (self::isDevContext()) return true;

        $pub = openssl_pkey_get_public(self::PUBLIC_KEY);
        if (!$pub) return false;

        $result = openssl_verify(
            $subject,
            base64_decode($signature_b64),
            $pub,
            OPENSSL_ALGO_SHA256
        );

        return $result === 1;
    }

    /**
     * Check the core license defined in cfg/license.php.
     * Returns true if valid.  Logs on failure.
     */
    public static function checkCore(): bool {
        if (self::isDevContext()) return true;
        if (!defined('EC_LICENSED_DOMAIN') || !defined('EC_LICENSE_SIG')) {
            error_log('EdgeCart: core license file missing.');
            return false;
        }

        $domain  = self::currentDomain();
        $ok = $domain === EC_LICENSED_DOMAIN
           && self::verify(EC_LICENSED_DOMAIN, EC_LICENSE_SIG);

        if (!$ok) {
            error_log("EdgeCart: core license invalid for domain '{$domain}'.");
        }
        return $ok;
    }

    /**
     * Check a plugin license.
     * Returns true if valid (or no license file present in dev context).
     */
    public static function checkPlugin(string $code, string $licensed_domain, string $signature_b64): bool {
        if (self::isDevContext()) return true;

        $domain = self::currentDomain();
        $ok = $domain === $licensed_domain
           && self::verify($code . ':' . $licensed_domain, $signature_b64);

        if (!$ok) {
            error_log("EdgeCart: plugin '{$code}' license invalid for domain '{$domain}'.");
        }
        return $ok;
    }

    /**
     * Extract the SLD (second-level domain) from HTTP_HOST.
     * "www.example.com" → "example"
     * "store.example.co.uk" → "example"
     * Licenses match on SLD only, so .com/.net/.org and all subdomains are covered.
     */
    public static function currentDomain(): string {
        $host = strtolower($_SERVER['HTTP_HOST'] ?? '');
        $host = preg_replace('/:\d+$/', '', $host); // strip port
        $parts = explode('.', $host);
        return count($parts) >= 2 ? $parts[count($parts) - 2] : $host;
    }

    /**
     * Check the core license and hard-block (render a purchase page and exit)
     * if it doesn't match the current domain. Used at install time and on every
     * storefront/admin request — unlike checkCore(), which only logs.
     */
    public static function enforceOrBlock(): void {
        if (self::checkCore()) return;
        self::renderLicenseRequiredPage();
        exit;
    }

    /**
     * A plain, dependency-free HTML page (no Smarty, no DB) explaining that
     * this domain isn't licensed, with a purchase link pre-filled for the
     * domain actually being visited. Used at install time — before the DB or
     * template engine are configured — and at runtime on a license failure.
     */
    public static function renderLicenseRequiredPage(): void {
        http_response_code(403);
        $domain = htmlspecialchars($_SERVER['HTTP_HOST'] ?? 'this domain', ENT_QUOTES, 'UTF-8');
        // Deliberately the store's homepage, not a direct checkout/cart link —
        // a visitor hitting this page hasn't chosen anything to buy yet, and
        // skipping straight to checkout means they never see the plugin
        // showcase at all. Let them land on the store and choose.
        $buyUrl = 'https://store.edgecart.io/';
        echo <<<HTML
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>License Required — EdgeCart</title>
<style>
	*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
	body {
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
		background: #0f1625;
		color: #dde4f0;
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2rem;
	}
	.card {
		max-width: 560px;
		width: 100%;
		background: #19243a;
		border: 1px solid rgba(255,255,255,.08);
		border-radius: 14px;
		padding: 2.75rem;
	}
	h1 {
		font-size: 1.5rem;
		margin-bottom: .75rem;
	}
	.domain {
		color: #82b1ff;
		font-weight: 700;
	}
	p.lead {
		color: #b8c4d8;
		line-height: 1.6;
		margin-bottom: 1.75rem;
	}
	ul.benefits {
		list-style: none;
		margin-bottom: 2rem;
	}
	ul.benefits li {
		padding: .55rem 0;
		border-bottom: 1px solid rgba(255,255,255,.06);
		display: flex;
		gap: .65rem;
		color: #dde4f0;
		font-size: .95rem;
	}
	ul.benefits li:last-child { border-bottom: none; }
	ul.benefits li::before { content: "✓"; color: #2979ff; font-weight: 700; }
	.btn-buy {
		display: block;
		text-align: center;
		background: #2979ff;
		color: #fff;
		text-decoration: none;
		font-weight: 700;
		font-size: 1.05rem;
		padding: 1rem;
		border-radius: 9px;
		transition: background .15s;
	}
	.btn-buy:hover { background: #1a65e0; }
	p.note {
		margin-top: 1.25rem;
		font-size: .82rem;
		color: #7a8ba8;
		text-align: center;
		text-wrap: balance;
	}
</style>
</head>
<body>
	<div class="card">
		<h1>EdgeCart isn't licensed for <span class="domain">{$domain}</span></h1>
		<p class="lead">
			This copy of EdgeCart is signed for a different domain.
		</p>
		<ul class="benefits">
			<li>Download EdgeCart for free — own your store's code, no monthly platform fees</li>
			<li>Free updates and security patches for life</li>
			<li>19+ premium plugins available (shipping, tax, themes, marketing)</li>
			<li>Self-hosted — your data, your server, your rules</li>
		</ul>
		<a class="btn-buy" href="{$buyUrl}">Get EdgeCart for {$domain} &rarr;</a>
		<p class="note">Already purchased? Check that your license's domain matches this one, exactly.</p>
	</div>
</body>
</html>
HTML;
    }

    // ── Dev context detection ──────────────────────────────────────────────────

    private static function isDevContext(): bool {
        return PHP_SAPI === 'cli';
    }
}

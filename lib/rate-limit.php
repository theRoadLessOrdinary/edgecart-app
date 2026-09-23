<?php
/**
 * Rate limiting class for blocking abuse
 * Uses in-memory tracking with timestamps
 * Simple, fast, resets on server restart
 */

class RateLimit {
	private static $attempts = [];
	private static $cleanup_interval = 3600; // Clean old entries every hour

	/**
	 * Check if action is within rate limit
	 * @param string $key Unique key: "ip:endpoint", "customer_id:action", etc.
	 * @param int $limit Max attempts allowed
	 * @param int $window Time window in seconds
	 * @return bool true if within limit, false if blocked
	 */
	public static function check($key, $limit, $window) {
		$now = time();
		$cutoff = $now - $window;

		// Initialize or clean up old entries
		if (!isset(self::$attempts[$key])) {
			self::$attempts[$key] = [];
		}

		// Clean entries older than window
		self::$attempts[$key] = array_filter(
			self::$attempts[$key],
			function ($timestamp) use ($cutoff) {
				return $timestamp > $cutoff;
			}
		);

		// Check limit
		$count = count(self::$attempts[$key]);
		if ($count >= $limit) {
			return false;
		}

		// Record attempt
		self::$attempts[$key][] = $now;
		return true;
	}

	/**
	 * Get remaining attempts before block
	 * @param string $key
	 * @param int $limit
	 * @param int $window
	 * @return int Remaining attempts (0 or negative if blocked)
	 */
	public static function remaining($key, $limit, $window) {
		$now = time();
		$cutoff = $now - $window;

		if (!isset(self::$attempts[$key])) {
			return $limit;
		}

		$count = count(array_filter(
			self::$attempts[$key],
			function ($timestamp) use ($cutoff) {
				return $timestamp > $cutoff;
			}
		));

		return max(0, $limit - $count);
	}

	/**
	 * Reset attempts for a key
	 * @param string $key
	 */
	public static function reset($key) {
		unset(self::$attempts[$key]);
	}

	/**
	 * Get client IP address
	 * Handles proxies and load balancers
	 * @return string IP address
	 */
	public static function getClientIp() {
		// Check for shared internet
		if (!empty($_SERVER['HTTP_CLIENT_IP'])) {
			$ip = $_SERVER['HTTP_CLIENT_IP'];
		}
		// Check for IP passed from proxy
		elseif (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
			// Handle multiple IPs (take first)
			$ips = explode(',', $_SERVER['HTTP_X_FORWARDED_FOR']);
			$ip = trim($ips[0]);
		}
		// Direct connection
		else {
			$ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
		}

		// Validate IP format
		if (filter_var($ip, FILTER_VALIDATE_IP)) {
			return $ip;
		}

		return '0.0.0.0';
	}
}

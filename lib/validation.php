<?php
/**
 * Input validation helpers
 * Type-safe validation for common data types
 */

class Validation {
	/**
	 * Validate integer with range
	 * @param mixed $val
	 * @param int $min Minimum value (inclusive)
	 * @param int $max Maximum value (inclusive)
	 * @return int|false Returns int if valid, false otherwise
	 */
	public static function int($val, $min = 0, $max = PHP_INT_MAX) {
		$int = (int)$val;
		if ((string)$int !== (string)$val) {
			return false; // Strict check: "5" is ok, "5x" is not
		}
		if ($int < $min || $int > $max) {
			return false;
		}
		return $int;
	}

	/**
	 * Validate email address
	 * @param mixed $val
	 * @return string|false Returns email if valid, false otherwise
	 */
	public static function email($val) {
		$val = trim((string)$val);
		if (!filter_var($val, FILTER_VALIDATE_EMAIL)) {
			return false;
		}
		return $val;
	}

	/**
	 * Validate decimal/float with range
	 * @param mixed $val
	 * @param float $min Minimum value (inclusive)
	 * @param float $max Maximum value (inclusive)
	 * @return float|false Returns float if valid, false otherwise
	 */
	public static function decimal($val, $min = 0, $max = PHP_FLOAT_MAX) {
		$float = (float)$val;
		if ($float < $min || $float > $max) {
			return false;
		}
		return $float;
	}

	/**
	 * Validate string length
	 * @param mixed $val
	 * @param int $minLen Minimum length (inclusive)
	 * @param int $maxLen Maximum length (inclusive)
	 * @return string|false Returns trimmed string if valid, false otherwise
	 */
	public static function string($val, $minLen = 0, $maxLen = 65535) {
		$str = trim((string)$val);
		$len = mb_strlen($str, 'UTF-8');
		if ($len < $minLen || $len > $maxLen) {
			return false;
		}
		return $str;
	}

	/**
	 * Validate slug format (lowercase, hyphens, alphanumeric)
	 * @param mixed $val
	 * @return string|false Returns slug if valid, false otherwise
	 */
	public static function slug($val) {
		$val = trim((string)$val);
		if (!preg_match('/^[a-z0-9]+(-[a-z0-9]+)*$/', $val)) {
			return false;
		}
		return $val;
	}

	/**
	 * Validate date format YYYY-MM-DD
	 * @param mixed $val
	 * @return string|false Returns date if valid, false otherwise
	 */
	public static function date($val) {
		$val = trim((string)$val);
		if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $val)) {
			return false;
		}
		// Validate it's a real date
		if (!strtotime($val)) {
			return false;
		}
		return $val;
	}

	/**
	 * Validate rating (1-5 stars)
	 * @param mixed $val
	 * @return int|false Returns 1-5 if valid, false otherwise
	 */
	public static function rating($val) {
		$int = (int)$val;
		if ($int < 1 || $int > 5) {
			return false;
		}
		return $int;
	}

	/**
	 * Validate URL format
	 * @param mixed $val
	 * @return string|false Returns URL if valid, false otherwise
	 */
	public static function url($val) {
		$val = trim((string)$val);
		if (!filter_var($val, FILTER_VALIDATE_URL)) {
			return false;
		}
		return $val;
	}

	/**
	 * Validate one of allowed values
	 * @param mixed $val
	 * @param array $allowed Allowed values
	 * @return mixed Returns value if in allowed list, false otherwise
	 */
	public static function enum($val, $allowed) {
		if (in_array($val, $allowed, true)) {
			return $val;
		}
		return false;
	}

	/**
	 * Validate JSON string is valid
	 * @param mixed $val
	 * @return array|false Returns decoded array if valid, false otherwise
	 */
	public static function json($val) {
		$val = trim((string)$val);
		if (empty($val)) {
			return false;
		}
		$decoded = json_decode($val, true);
		if (json_last_error() !== JSON_ERROR_NONE) {
			return false;
		}
		return $decoded;
	}
}

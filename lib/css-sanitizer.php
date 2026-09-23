<?php
/**
 * Basic CSS sanitizer to prevent CSS injection attacks.
 * Strips dangerous selectors and properties that could enable XSS.
 */

function sanitize_css(string $css): string {
	// Remove @import, @media with expression, javascript: URLs
	$css = preg_replace('/@import\s+["\']?(?:https?:)?\/\//', '', $css);
	$css = preg_replace('/javascript:/i', '', $css);
	$css = preg_replace('/expression\s*\(/i', '', $css);
	$css = preg_replace('/behavior\s*:/i', '', $css);
	$css = preg_replace('/-moz-binding\s*:/i', '', $css);

	// Remove data: URIs (potential for embedded JS)
	$css = preg_replace('/url\s*\(\s*data:/i', 'url(about:blank', $css);

	// Remove event handlers in selectors (e.g., *:hover with javascript)
	$css = preg_replace('/on\w+\s*=/i', '', $css);

	// Remove CSS keyframe animations with harmful content
	$css = preg_replace('/@keyframes.*?{.*?}/is', '', $css);

	return trim($css);
}

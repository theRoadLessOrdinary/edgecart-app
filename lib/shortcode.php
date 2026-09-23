<?php
/**
 * shortcode.php
 * WordPress-style [tag attr="value"] handler. Plugins register a tag during
 * app.boot; Shortcode::render() is applied to plain page/content text so
 * plugin-provided block types (slideshow, form, ...) work even without
 * Page Block Editor installed.
 */
class Shortcode
{
	private static array $tags = [];

	public static function add(string $tag, callable $callback): void
	{
		self::$tags[$tag] = $callback;
	}

	public static function render(string $content): string
	{
		if (!self::$tags || strpos($content, '[') === false) {
			return $content;
		}

		$tagPattern = implode('|', array_map(
			fn($t) => preg_quote($t, '/'),
			array_keys(self::$tags)
		));

		return preg_replace_callback(
			'/\[(' . $tagPattern . ')((?:\s+[a-zA-Z_][a-zA-Z0-9_-]*="[^"]*")*)\s*\]/',
			function (array $m): string {
				$tag  = $m[1];
				$atts = [];
				if (!empty($m[2])) {
					preg_match_all('/([a-zA-Z_][a-zA-Z0-9_-]*)="([^"]*)"/', $m[2], $pairs, PREG_SET_ORDER);
					foreach ($pairs as $pair) {
						$atts[$pair[1]] = $pair[2];
					}
				}
				try {
					return (string)(self::$tags[$tag])($atts);
				} catch (\Throwable $e) {
					error_log('Shortcode [' . $tag . '] failed: ' . $e->getMessage());
					return '';
				}
			},
			$content
		);
	}
}

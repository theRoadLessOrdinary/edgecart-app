<?php
if (file_exists(__DIR__ . '/.installed')) {
	http_response_code(403);
	exit('Installation is already complete. Remove install/.installed to reinstall.');
}

require_once __DIR__ . '/../lib/license.php';
if (file_exists(__DIR__ . '/../cfg/license.php')) {
	require_once __DIR__ . '/../cfg/license.php';
}
License::enforceOrBlock();

function randomAdminPath(): string {
	$consonants = 'bcdfghjklmnpqrstvwxyzBCDFGHJKLMNPQRSTVWXYZ';
	$digits     = '23456789';
	$all        = $consonants . $digits;
	$len        = 12;
	do {
		$str = '';
		for ($i = 0; $i < $len; $i++) {
			$pool = ($i === 0 || $i === $len - 1) ? $consonants : $all;
			$str .= $pool[random_int(0, strlen($pool) - 1)];
		}
	} while (!preg_match('/[a-zA-Z]/', $str[0]) || !preg_match('/[a-zA-Z]/', $str[$len - 1]));
	return $str;
}

$defaultAdminPath = randomAdminPath();
?>
<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>EdgeCart - Install</title>
	<style>
		*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

		body {
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
			background: #f0f2f5;
			min-height: 100vh;
			display: flex;
			align-items: center;
			justify-content: center;
			padding: 2rem;
		}

		#wizard {
			background: #fff;
			border-radius: .75rem;
			border: 1px solid #c9cdd4;
			box-shadow: 0 4px 32px rgba(0,0,0,.18);
			width: 100%;
			max-width: 780px;
			overflow: hidden;
		}

		#wizard-header { background: #2c3e50; color: #fff; padding: 1.5rem 2rem; }
		#wizard-header h1 { font-size: 1.4rem; font-weight: 600; margin-bottom: .2rem; }
		#wizard-header p  { font-size: .85rem; opacity: .8; }

		/* ── Perm check styles (used inside step-1) ── */
		#perm-content { min-height: 80px; }

		.perm-ok   { background: #dcfce7; color: #14532d; border: 1px solid #bbf7d0; border-radius: .5rem; padding: .85rem 1rem; margin-bottom: .75rem; }
		.perm-error { background: #fee2e2; color: #7f1d1d; border: 1px solid #fecaca; border-radius: .5rem; padding: 1rem; margin-bottom: .75rem; }

		#perm-dir-list { list-style: none; margin: .75rem 0 0; padding: 0; }
		#perm-dir-list li {
			display: flex; align-items: center; gap: .5rem;
			font-size: .85rem; padding: .3rem 0;
			border-bottom: 1px solid rgba(0,0,0,.06);
			color: #1a1a1a;
		}
		#perm-dir-list li:last-child { border-bottom: none; }
		#perm-dir-list .icon-ok   { color: #16a34a; font-size: 1rem; }
		#perm-dir-list .icon-fail { color: #dc2626; font-size: 1rem; }
		#perm-dir-list .dir-path  { font-family: monospace; font-size: .82rem; color: #444; margin-left: auto; }

		#perm-fix-cmd {
			background: #1a1a1a; color: #f0f0f0; font-family: monospace;
			font-size: .8rem; padding: .6rem .85rem; border-radius: .375rem;
			margin: .5rem 0 .75rem; white-space: pre-wrap; word-break: break-all;
			line-height: 1.6;
		}

		/* ── Wizard body ── */
		#wizard-body { transition: opacity .3s; }

		#step-nav { display: flex; border-bottom: 1px solid #5a6472; background: #f8f9fa; }

		.step-tab {
			flex: 1; padding: .7rem .25rem; text-align: center;
			font-size: .73rem; font-weight: 600; color: #555;
			border-bottom: 3px solid transparent;
			transition: color .2s, border-color .2s; line-height: 1.3;
		}
		.step-tab.active   { color: #2563eb; border-bottom-color: #2563eb; }
		.step-tab.complete { color: #16a34a; border-bottom-color: #16a34a; }

		.step { display: none; padding: 1.75rem 2rem; }
		.step.active { display: block; }
		.step h2 { font-size: 1.05rem; font-weight: 600; margin-bottom: .4rem; color: #1a1a1a; }
		.step .step-desc { font-size: .85rem; color: #333; margin-bottom: 1.25rem; line-height: 1.5; }

		.subsection {
			border: 1px solid #5a6472; border-radius: .5rem;
			padding: 1rem 1.25rem; margin-bottom: 1.25rem;
		}
		.subsection-head {
			font-size: .75rem; font-weight: 700; text-transform: uppercase;
			letter-spacing: .06em; color: #444; margin-bottom: .85rem;
		}

		.field { margin-bottom: .85rem; }
		.field:last-child { margin-bottom: 0; }
		.field label { display: block; font-size: .85rem; font-weight: 600; color: #1a1a1a; margin-bottom: .3rem; }

		.field input[type=text],
		.field input[type=email],
		.field input[type=password] {
			width: 100%; padding: .5rem .7rem;
			border: 1px solid #5a6472; border-radius: .375rem;
			font-size: .92rem; color: #1a1a1a; outline: none;
			transition: border-color .15s, box-shadow .15s;
		}
		.field input:focus { border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,.12); }
		.field input:disabled { background: #f9fafb; color: #888; }

		.pw-field-wrap { position: relative; }
		.pw-field-wrap input { padding-right: 2.3rem; }
		.pw-field-wrap.has-copy input { padding-right: 4.3rem; }
		.btn-gen-pass, .btn-copy-field {
			position: absolute; top: 50%; transform: translateY(-50%);
			background: none; border: none; cursor: pointer; font-size: 1.05rem;
			padding: .25rem .4rem; line-height: 1; border-radius: .3rem;
		}
		.btn-gen-pass { right: .25rem; color: #92400e; }
		.btn-copy-field { right: .25rem; color: #2563eb; }
		.pw-field-wrap.has-copy .btn-gen-pass { right: 2rem; }
		.btn-gen-pass:hover, .btn-copy-field:hover { background: #f3f4f6; }

		.hint { font-size: .78rem; color: #333; margin-top: .3rem; line-height: 1.5; }
		.hint code { background: #f3f4f6; padding: .1em .35em; border-radius: .2rem; font-size: .88em; color: #1a1a1a; }
		.hint.warn { color: #92400e; font-weight: 500; }

		.field-row { display: flex; gap: .85rem; }
		.field-row .field { flex: 1; }

		#status {
			margin: 0 2rem .75rem; padding: .65rem .9rem;
			border-radius: .375rem; font-size: .87rem; display: none; font-weight: 500;
		}
		#status.ok    { background: #dcfce7; color: #14532d; }
		#status.error { background: #fee2e2; color: #7f1d1d; }

		.inline-status {
			font-size: .82rem; margin-top: .6rem; padding: .45rem .75rem;
			border-radius: .3rem; display: none; font-weight: 500;
		}
		.inline-status.ok    { background: #dcfce7; color: #14532d; }
		.inline-status.error { background: #fee2e2; color: #7f1d1d; }

		.btn-row { display: flex; justify-content: flex-end; gap: .65rem; margin-top: 1.25rem; align-items: center; }
		.btn-row-split { justify-content: space-between; }

		button {
			padding: .5rem 1.15rem; border: none; border-radius: .375rem;
			font-size: .88rem; font-weight: 600; cursor: pointer; transition: filter .15s;
		}
		button:disabled        { opacity: .45; cursor: not-allowed; }
		button:hover:not(:disabled) { filter: brightness(.93); }

		.btn-primary   { background: #2563eb; color: #fff; }
		.btn-secondary { background: #e5e7eb; color: #1a1a1a; }
		.btn-success   { background: #16a34a; color: #fff; }
		.btn-outline   { background: #fff; color: #2563eb; border: 1px solid #2563eb; }
		.btn-sm        { padding: .35rem .85rem; font-size: .82rem; }

		.spinner {
			display: inline-block; width: .85rem; height: .85rem;
			border: 2px solid rgba(255,255,255,.35); border-top-color: #fff;
			border-radius: 50%; animation: spin .6s linear infinite;
			vertical-align: middle; margin-right: .35rem;
		}
		.btn-secondary .spinner, .btn-outline .spinner {
			border-color: rgba(0,0,0,.2); border-top-color: #333;
		}
		@keyframes spin { to { transform: rotate(360deg); } }

		.cred-verified {
			font-size: .8rem; color: #14532d; font-weight: 600;
			display: none; margin-left: .5rem;
		}
		.cred-verified.show { display: inline; }

		#step-done { text-align: center; padding: 3rem 2rem; display: none; }
		#step-done .checkmark { font-size: 3rem; margin-bottom: 1rem; }
		#step-done h2 { font-size: 1.3rem; margin-bottom: .5rem; color: #1a1a1a; }
		#step-done p  { color: #333; margin-bottom: 1.5rem; font-size: .9rem; }

		.req { color: #b91c1c; margin-left: .15rem; }
		.match-ok   { color: #14532d; font-size: .78rem; margin-top: .3rem; font-weight: 500; }
		.match-fail { color: #7f1d1d; font-size: .78rem; margin-top: .3rem; font-weight: 500; }
	</style>
</head>
<body>
<div id="wizard">

	<div id="wizard-header">
		<h1>EdgeCart</h1>
		<p>Installation wizard</p>
	</div>

	<div id="wizard-body">

		<div id="step-nav">
			<div class="step-tab active" id="tab-1">1. Permissions</div>
			<div class="step-tab"        id="tab-2">2. Root &amp; DB</div>
			<div class="step-tab"        id="tab-3">3. DB User</div>
			<div class="step-tab"        id="tab-4">4. Admin</div>
			<div class="step-tab"        id="tab-5">5. Site</div>
			<div class="step-tab"        id="tab-6">6. Install</div>
		</div>

		<div id="status"></div>

		<!-- ── Step 1: Folder Permissions ── -->
		<div class="step active" id="step-1">
			<h2>Folder Permissions</h2>
			<p class="step-desc">EdgeCart needs write access to these directories to store configuration, cache, and uploaded files.</p>
			<div id="perm-content"><span style="color:#555;font-size:.88rem">Checking directory permissions…</span></div>
			<div class="btn-row" style="margin-top:1.25rem">
				<button class="btn-outline btn-sm" id="btn-recheck" style="display:none">Recheck</button>
				<button class="btn-primary" id="btn-perm-continue" disabled>Continue</button>
			</div>
		</div>

		<!-- ── Step 2: Root credentials + optional DB create ── -->
		<div class="step" id="step-2">
			<h2>Root &amp; Database</h2>
			<p class="step-desc">Enter your MySQL root credentials and choose a database name.</p>

			<div class="subsection">
				<div class="subsection-head">Database Setup</div>
				<div class="field">
					<label><input type="radio" name="db_setup_mode" id="db_mode_existing" value="existing" checked> My host already created my database and database user</label>
				</div>
				<div class="field" style="margin-top:.4rem">
					<label><input type="radio" name="db_setup_mode" id="db_mode_root" value="root"> I have MySQL root (or full admin) access</label>
				</div>
				<div class="hint" style="margin-top:.5rem">This is the most common setup on shared hosting (cPanel, Plesk, and similar) - your host creates the database and its user for you and never hands out true root access. If you were given a database name, username, and password rather than asked to create one yourself, "My host already created my database" is what you want.</div>
			</div>

			<div class="subsection" id="root-creds-section">
				<div class="subsection-head">MySQL Root Credentials <span class="req">*</span></div>
				<div class="field-row">
					<div class="field">
						<label>Host <span class="req">*</span></label>
						<input type="text" id="db_host" value="localhost">
						<div class="hint">Usually <code>localhost</code></div>
					</div>
					<div class="field">
						<label>Root Username <span class="req">*</span></label>
						<input type="text" id="db_root" value="root" >
					</div>
				</div>
				<div class="field">
					<label>Root Password <span class="req">*</span></label>
					<input type="password" id="db_rootpw">
					<div class="hint">Used only during installation - never saved.</div>
				</div>
				<div class="btn-row" style="margin-top:.85rem">
					<button class="btn-outline btn-sm" id="btn-test-root" disabled>Test Credentials</button>
					<span class="cred-verified" id="cred-ok">✓ Verified</span>
				</div>
				<div class="inline-status" id="test-root-status"></div>
			</div>

			<div class="subsection" id="create-db-section">
				<div class="subsection-head">Database <span class="req">*</span></div>
				<p class="hint" style="margin-bottom:.85rem">Enter the name of the database your store will use. If it doesn't already exist, it will be created.</p>
				<div class="field">
					<input type="text" id="db_name_create" placeholder="edgecart" disabled>
					<div class="hint">Letters, numbers and underscores only. Must start with a letter.</div>
				</div>
				<div class="inline-status" id="create-db-status"></div>
			</div>

			<div class="subsection" id="existing-db-section" style="display:none">
				<div class="subsection-head">Your Host's Database <span class="req">*</span></div>
				<div class="field">
					<label>Host <span class="req">*</span></label>
					<input type="text" id="db_host_existing" value="localhost">
					<div class="hint">Usually <code>localhost</code> - check your host's control panel if unsure.</div>
				</div>
				<div class="field">
					<label>Database Name <span class="req">*</span></label>
					<input type="text" id="db_name_existing" placeholder="e.g. yourusername_edgecart">
					<div class="hint">The exact database name your host created for you.</div>
				</div>
			</div>

			<div class="btn-row">
				<button class="btn-secondary" id="btn-back-2">Back</button>
				<button class="btn-primary" id="btn-step1-next" disabled>Continue</button>
			</div>
		</div>

		<!-- ── Step 3: DB user ── -->
		<div class="step" id="step-3">
			<h2 id="step3-title">Database User</h2>
			<p class="step-desc" id="step3-desc">Create a dedicated database user for EdgeCart. Safer than using root at runtime.</p>

			<div class="subsection">
				<div class="subsection-head" id="step3-subhead">New Database User</div>
				<div class="field-row">
					<div class="field">
						<label id="step3-user-label">Username <span class="req">*</span></label>
						<input type="text" id="db_user" >
						<div class="hint" id="step3-user-hint">e.g. <code>new_cart</code></div>
					</div>
					<div class="field">
						<label>Password <span class="req">*</span></label>
						<div class="pw-field-wrap has-copy">
							<input type="password" id="db_pass">
							<button type="button" class="btn-copy-field" data-copy-target="db_pass" title="Copy to clipboard">📋</button>
							<button type="button" class="btn-gen-pass" id="btn-gen-db-pass" data-target="db_pass" title="Generate a strong password">⚡</button>
						</div>
						<div class="hint" id="db-pass-policy">At least 10 characters, including 3 of: uppercase, lowercase, numbers, symbols.</div>
					</div>
				</div>
				<div class="field">
					<label>Database</label>
					<input type="text" id="db_name" readonly>
					<div class="hint">Created in the previous step.</div>
				</div>
				<div class="field">
					<label>Table Prefix</label>
					<input type="text" id="db_prefix" value="nc_">
					<div class="hint">Allows multiple apps to share one database. e.g. <code>nc_</code></div>
				</div>
			</div>

			<div class="btn-row">
				<button class="btn-secondary" id="btn-back-3">Back</button>
				<button class="btn-primary"   id="btn-create-user" disabled>Create User &amp; Continue</button>
			</div>
		</div>

		<!-- ── Step 4: Admin account ── -->
		<div class="step" id="step-4">
			<h2>Admin Account</h2>
			<p class="step-desc">This account will have full access to the admin panel.</p>
			<div class="field-row">
				<div class="field">
					<label>Username <span class="req">*</span></label>
					<input type="text" id="admin_user" >
					<div class="hint">Minimum 3 characters</div>
				</div>
				<div class="field">
					<label>Email <span class="req">*</span></label>
					<input type="email" id="admin_email" >
				</div>
			</div>
			<div class="field">
				<label>Password <span class="req">*</span></label>
				<div class="pw-field-wrap has-copy">
					<input type="password" id="admin_pass">
					<button type="button" class="btn-copy-field" data-copy-target="admin_pass" title="Copy to clipboard">📋</button>
					<button type="button" class="btn-gen-pass" data-target="admin_pass" title="Generate a strong password">⚡</button>
				</div>
				<div class="hint" id="admin-pass-policy">At least 8 characters, with a capital letter, a number, and a special character.</div>
			</div>
			<div class="field">
				<label>Confirm Password <span class="req">*</span></label>
				<input type="password" id="admin_confirm">
				<div id="pw-match-msg"></div>
			</div>
			<div class="btn-row">
				<button class="btn-secondary" id="btn-back-4">Back</button>
				<button class="btn-primary"   id="btn-validate-admin" disabled>Continue</button>
			</div>
		</div>

		<!-- ── Step 5: Site details ── -->
		<div class="step" id="step-5">
			<h2>Site Details</h2>
			<p class="step-desc">Editable any time in the admin panel.</p>
			<div class="field">
				<label>Store Name <span class="req">*</span></label>
				<input type="text" id="site_name" placeholder="My Store">
			</div>
			<div class="field-row">
				<div class="field" style="flex:0 0 140px">
					<label>Currency Symbol</label>
					<input type="text" id="site_currency" value="$">
				</div>
				<div class="field">
					<label>Store Email</label>
					<input type="email" id="site_email" placeholder="store@example.com">
					<div class="hint">Used for order confirmation emails</div>
				</div>
			</div>
			<div class="field">
				<label>Admin URL Path</label>
				<div class="pw-field-wrap">
					<input type="text" id="admin_path" value="<?= htmlspecialchars($defaultAdminPath) ?>">
					<button type="button" class="btn-copy-field" data-copy-target="admin_path" title="Copy to clipboard">📋</button>
				</div>
				<div class="hint">
					This is the web address you'll use to reach your admin panel:
					<code>/<span id="admin-path-preview"><?= htmlspecialchars($defaultAdminPath) ?></span>/</code>.
					Keep it somewhere safe - you'll need it every time you log in.
					A random value is pre-filled for security, or you can set something easier to remember.
				</div>
			</div>
			<div class="btn-row">
				<button class="btn-secondary" id="btn-back-5">Back</button>
				<button class="btn-primary"   id="btn-to-install" disabled>Continue</button>
			</div>
		</div>

		<!-- ── Step 6: Install ── -->
		<div class="step" id="step-6">
			<h2>Ready to Install</h2>
			<p class="step-desc">Clicking Install will:</p>
			<ul style="font-size:.88rem;color:#1a1a1a;margin:.5rem 0 1.25rem 1.5rem;line-height:2.2">
				<li>Create all database tables</li>
				<li>Create your admin account</li>
				<li>Write <code>cfg/config.php</code></li>
				<li>Lock this install wizard</li>
			</ul>
			<p class="hint warn">To reinstall later, delete <code>install/.installed</code> and <code>cfg/config.php</code>.</p>
			<div class="btn-row">
				<button class="btn-secondary" id="btn-back-6">Back</button>
				<button class="btn-success"   id="btn-install">Install EdgeCart</button>
			</div>
		</div>

		<!-- ── Done ── -->
		<div id="step-done">
			<div class="checkmark">✅</div>
			<h2>Installation Complete</h2>
			<p>Your store is ready. Log in to the admin panel to get started.</p>
			<div id="generated-pass-reminder" style="display:none; margin:0 auto 1.5rem; max-width:26rem; padding:.85rem 1rem; background:#fffbeb; border:1px solid #fde68a; border-radius:.5rem; text-align:left;">
				<div style="font-size:.82rem; font-weight:600; color:#92400e; margin-bottom:.3rem;">Save your admin password - it won't be shown again:</div>
				<code id="generated-pass-value" style="display:block; font-size:1rem; word-break:break-all; color:#1a1a1a;"></code>
			</div>
			<button class="btn-success" id="btn-go-admin">Go to Admin</button>
		</div>

	</div><!-- /wizard-body -->

</div><!-- /wizard -->

<script>
(function () {
	'use strict';

	const AJAX = 'ajax.php';

	function val(id)  { return document.getElementById(id).value.trim(); }
	function pval(id) { return document.getElementById(id).value; }
	function el(id)   { return document.getElementById(id); }

	// ── Password generator (⚡ buttons) ─────────────────────────────────────────
	const PASSPHRASE_WORDS = [
		"Access", "Act", "Action", "Actor", "Ad", "Advice", "Affair", "Age", "Agency", "Air",
		"Amount", "Animal", "Answer", "Apple", "Area", "Army", "Art", "Aspect", "Aunt", "Back",
		"Bad", "Ball", "Bank", "Basis", "Basket", "Bath", "Beer", "Bird", "Birth", "Bit",
		"Blood", "Board", "Boat", "Body", "Bonus", "Book", "Boss", "Bottom", "Box", "Boy",
		"Bread", "Breath", "Bus", "Buyer", "Camera", "Cancer", "Car", "Card", "Care", "Career",
		"Case", "Cash", "Cat", "Cause", "Cell", "Chance", "Cheek", "Chest", "Child", "Choice",
		"Church", "City", "Class", "Client", "Coast", "Coffee", "Cookie", "County", "Course", "Cousin",
		"Craft", "Credit", "Cycle", "Dad", "Data", "Date", "Day", "Dealer", "Death", "Debt",
		"Demand", "Depth", "Design", "Desk", "Device", "Dinner", "Dirt", "Disk", "Dog", "Drama",
		"Drawer", "Driver", "Ear", "Earth", "Editor", "Effect", "Effort", "Egg", "End", "Energy",
		"Engine", "Entry", "Error", "Estate", "Event", "Exam", "Extent", "Eye", "Face", "Fact",
		"Family", "Farmer", "Fat", "Field", "Figure", "Film", "Fire", "Fish", "Flight", "Focus",
		"Food", "Force", "Form", "Frame", "Fun", "Future", "Game", "Garden", "Gate", "Gene",
		"Gift", "Girl", "Goal", "Group", "Growth", "Guest", "Guide", "Guitar", "Hair", "Half",
		"Hall", "Hand", "Hat", "Head", "Health", "Heart", "Heat", "Height", "Home", "Honey",
		"Hope", "Hotel", "House", "Ice", "Idea", "Image", "Impact", "Income", "Injury", "Insect",
		"Inside", "Issue", "Item", "Job", "Key", "Kind", "King", "Lab", "Ladder", "Lady",
		"Lake", "Law", "Leader", "Length", "Level", "Life", "Light", "Line", "Link", "List",
		"Loss", "Love", "Mall", "Man", "Map", "Market", "Math", "Matter", "Meal", "Meat",
		"Media", "Medium", "Member", "Memory", "Menu", "Metal", "Method", "Mind", "Mode", "Model",
		"Mom", "Moment", "Money", "Month", "Mood", "Mouse", "Movie", "Mud", "Music", "Name",
		"Nation", "Nature", "News", "Night", "Note", "Number", "Object", "Office", "Oil", "Orange",
		"Order", "Oven", "Owner", "Page", "Paint", "Paper", "Part", "People", "Period", "Person",
		"Phone", "Photo", "Piano", "Pie", "Piece", "Pizza", "Place", "Plan", "Player", "Poem",
		"Poet", "Poetry", "Point", "Police", "Policy", "Post", "Pot", "Potato", "Power", "Price",
		"Profit", "Queen", "Radio", "Range", "Rate", "Ratio", "Reason", "Recipe", "Record", "Region",
		"Result", "Review", "Risk", "River", "Road", "Rock", "Role", "Room", "Rule", "Safety",
		"Salad", "Salt", "Sample", "Scale", "Scene", "School", "Screen", "Sector", "Sense", "Series",
		"Shape", "Share", "Shirt", "Side", "Sign", "Singer", "Sir", "Sister", "Site", "Size",
		"Skill", "Soil", "Son", "Song", "Sound", "Soup", "Source", "Space", "Speech", "Sport",
		"Square", "Star", "State", "Steak", "Step", "Stock", "Store", "Story", "Stress", "Studio",
		"Study", "Style", "Sun", "System", "Table", "Tale", "Task", "Tax", "Tea", "Tennis",
		"Term", "Test", "Thanks", "Theory", "Thing", "Throat", "Time", "Tongue", "Tool", "Tooth",
		"Top", "Topic", "Town", "Trade", "Truth", "Two", "Type", "Uncle", "Union", "Unit",
		"User", "Value", "Video", "View", "Virus", "Voice", "Volume", "War", "Water", "Way",
		"Wealth", "Web", "Week", "While", "Wife", "Wind", "Winner", "Woman", "Wood", "Word",
		"Work", "Worker", "World", "Writer", "Year", "Youth", "Beans", "Bear",
		"Blouse", "Bed", "Bucket", "Bakery", "Bow", "Bridge", "Cow", "Cap", "Cooker", "Cheeks",
		"Crest", "Chair", "Candy", "Donkey", "Drum", "Frog", "Fan", "Foot",
		"Flag", "Awe", "Beauty", "Belief", "Crime", "Hate", "Hatred", "Joy",
		"Luck", "Luxury", "Need", "Sanity", "Speed", "Trend",
		"Warmth", "Tree", "Friend", "Botany", "Bacon", "Chaos", "Calm", "Cotton", "Duty", "Fame",
		"Grass", "Golf", "Hunger", "Jam", "Herd", "Pack", "Flock",
		"Swarm", "Shoal", "Crowd", "Gang", "Mob", "Staff", "Crew", "Choir", "Panel",
		"Troupe", "Bunch", "Pile", "Heap", "Stack", "Shower", "Fall",
		"Myself", "Teacup", "Teapot"
	];
	const PASSPHRASE_PUNCTUATION = ["@", "#", "$", "%", "^", "&", "*", "_", "-", "+", "=", "!"];

	// 4 random capitalized words, each followed by a random (non-repeating)
	// punctuation mark, plus a trailing 1-2 digit number.
	function generatePassphrase() {
		const punct = PASSPHRASE_PUNCTUATION.slice();
		function takePunct() {
			const i = Math.floor(Math.random() * punct.length);
			return punct.splice(i, 1)[0];
		}
		let out = '';
		for (let i = 0; i < 4; i++) {
			const word = PASSPHRASE_WORDS[Math.floor(Math.random() * PASSPHRASE_WORDS.length)];
			out += word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() + takePunct();
		}
		return out + Math.floor(Math.random() * 99);
	}

	// Tracks whether the admin password currently in the field is one we
	// generated (vs. hand-typed) — used to show it once more on the final
	// "Installation Complete" screen, since the 5s inline reveal above is easy
	// to miss and this is the customer's only login credential.
	let adminPassGenerated = false;

	document.querySelectorAll('.btn-gen-pass').forEach(function (btn) {
		btn.addEventListener('click', function () {
			const targetId = btn.dataset.target;
			const pass     = generatePassphrase();
			const input    = el(targetId);

			function reveal(field) {
				field.type = 'text';
				clearTimeout(field._revealTimer);
				field._revealTimer = setTimeout(() => { field.type = 'password'; }, 5000);
			}

			if (targetId === 'admin_pass') input.dataset.lastGenerated = pass;
			input.value = pass;
			input.dispatchEvent(new Event('input', { bubbles: true }));
			reveal(input);

			// The admin step has a confirm field — fill it to match so the
			// customer doesn't have to retype a generated password by hand.
			if (targetId === 'admin_pass') {
				const confirmInput = el('admin_confirm');
				confirmInput.value = pass;
				confirmInput.dispatchEvent(new Event('input', { bubbles: true }));
				reveal(confirmInput);
				adminPassGenerated = true;
			}
		});
	});

	// Manually editing the admin password after generating it means it's no
	// longer the value we'd be showing back — stop treating it as "generated".
	el('admin_pass').addEventListener('input', function () {
		if (this.value !== this.dataset.lastGenerated) adminPassGenerated = false;
	});

	// ── Click-to-copy (📋 buttons) ───────────────────────────────────────────────
	// navigator.clipboard requires a secure context (https, or literally
	// "localhost") — a plain http:// dev vhost like this one doesn't qualify,
	// so fall back to the classic hidden-textarea + execCommand approach.
	function copyText(text) {
		if (window.isSecureContext && navigator.clipboard) {
			return navigator.clipboard.writeText(text);
		}
		return new Promise(function (resolve) {
			const ta = document.createElement('textarea');
			ta.value = text;
			ta.style.position = 'fixed';
			ta.style.opacity   = '0';
			document.body.appendChild(ta);
			ta.focus();
			ta.select();
			try { document.execCommand('copy'); } catch (e) { /* ignore */ }
			document.body.removeChild(ta);
			resolve();
		});
	}

	document.querySelectorAll('.btn-copy-field').forEach(function (btn) {
		btn.addEventListener('click', function () {
			const input = el(btn.dataset.copyTarget);
			copyText(input.value).then(function () {
				const orig = btn.textContent;
				btn.textContent = '✓';
				setTimeout(() => { btn.textContent = orig; }, 1500);
			});
		});
	});

	function setStatus(msg, type) {
		const s = el('status');
		s.textContent   = msg;
		s.className     = type;
		s.style.display = msg ? 'block' : 'none';
	}

	function setInline(id, msg, type) {
		const s = el(id);
		s.textContent   = msg;
		s.className     = 'inline-status ' + type;
		s.style.display = msg ? 'block' : 'none';
	}

	function clearStatus() { setStatus('', ''); }

	function setLoading(btn, on) {
		if (on) {
			btn._orig     = btn.innerHTML;
			btn.innerHTML = '<span class="spinner"></span>Working…';
			btn.disabled  = true;
		} else {
			btn.innerHTML = btn._orig;
			btn.disabled  = false;
		}
	}

	async function ajax(data) {
		const fd = new FormData();
		Object.entries(data).forEach(([k, v]) => fd.append(k, v));
		const r = await fetch(AJAX, { method: 'POST', body: fd });
		const text = await r.text();
		try {
			return JSON.parse(text);
		} catch (e) {
			// A PHP warning/notice ahead of our JSON (e.g. a permissions error
			// hit while writing a file) breaks a plain response.json() with an
			// opaque "unexpected character" error. Try to recover the JSON
			// object from the tail of the response first...
			const idx = text.lastIndexOf('{');
			if (idx !== -1) {
				try { return JSON.parse(text.slice(idx)); } catch (e2) { /* fall through */ }
			}
			// ...and if that fails too, surface the actual server output
			// (stripped of markup) instead of the parse error.
			const stripped = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
			throw new Error('Unexpected server response: ' + (stripped.slice(0, 300) || '(empty)'));
		}
	}

	// ── Tab navigation ────────────────────────────────────────────────────────
	function goToStep(n) {
		document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
		document.querySelectorAll('.step-tab').forEach(t => t.classList.remove('active'));
		const step = el('step-' + n);
		const tab  = el('tab-'  + n);
		if (step) step.classList.add('active');
		if (tab)  tab.classList.add('active');
		clearStatus();
	}

	function markComplete(n) {
		const t = el('tab-' + n);
		if (t) { t.classList.remove('active'); t.classList.add('complete'); }
	}

	function goBack(fromStep) {
		const n = fromStep - 1;
		document.querySelectorAll('.step-tab').forEach(t => t.classList.remove('active'));
		const prevTab = el('tab-' + n);
		if (prevTab) { prevTab.classList.remove('complete'); prevTab.classList.add('active'); }
		const curTab = el('tab-' + fromStep);
		if (curTab)  curTab.classList.remove('active', 'complete');
		document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
		const step = el('step-' + n);
		if (step) step.classList.add('active');
		clearStatus();
	}

	// ── Step 1: Folder Permissions ────────────────────────────────────────────
	function escH(str) {
		return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
	}

	async function checkPermissions() {
		const content  = el('perm-content');
		const btnCont  = el('btn-perm-continue');
		const btnRechk = el('btn-recheck');

		content.innerHTML = '<span style="color:#555;font-size:.88rem">Checking directory permissions…</span>';
		btnCont.disabled  = true;
		btnRechk.style.display = 'none';

		try {
			const res = await ajax({ action: 'check_permissions' });

			if (res.ok) {
				let listHtml = '<ul id="perm-dir-list">';
				(res.details || []).forEach(d => {
					const label = d.split(':')[0];
					listHtml += `<li><span class="icon-ok">&#10003;</span> ${escH(label)}/</li>`;
				});
				listHtml += '</ul>';

				content.innerHTML = '<div class="perm-ok"><strong>Directory permissions OK</strong>' + listHtml + '</div>';
				btnCont.disabled  = false;

			} else {
				let listHtml = '<ul id="perm-dir-list">';
				(res.details || []).forEach(d => {
					const label   = d.split(':')[0];
					const isOk    = d.includes(': OK');
					const icon    = isOk
						? '<span class="icon-ok">&#10003;</span>'
						: '<span class="icon-fail">&#10007;</span>';
					const isFile  = label === '.htaccess';
					const path    = !isOk && res.base ? escH(res.base + label) : '';
					const pathEl  = path ? `<span class="dir-path">${path}</span>` : '';
					const ownerNote = d.match(/ - (owned by.*)$/);
					const noteEl  = !isOk && ownerNote
						? `<div style="font-size:.78rem;color:#7f1d1d;margin:.15rem 0 .4rem 1.4rem">${escH(ownerNote[1])}</div>`
						: '';
					listHtml += `<li>${icon} ${escH(label)}${isFile ? '' : '/'} ${pathEl}</li>${noteEl}`;
				});
				listHtml += '</ul>';

				const fixCmd = res.base
					? `find ${res.base}cfg ${res.base}cache ${res.base}logs ${res.base}img ${res.base}install -type d -exec chmod 755 {} +\n` +
					  `find ${res.base}cfg ${res.base}cache ${res.base}logs ${res.base}img ${res.base}install -type f -exec chmod 644 {} +\n` +
					  `chmod 644 ${res.base}.htaccess`
					: '';

				const linuxBlock = fixCmd
					? '<div style="font-size:.82rem;font-weight:600;margin:.75rem 0 .3rem">Linux / Mac (terminal):</div>' +
					  '<div id="perm-fix-cmd">' + escH(fixCmd) + '</div>' +
					  '<div style="margin-bottom:.75rem"><button class="btn-outline btn-sm" id="btn-copy-fix">Copy Command</button>' +
					  ' <span id="copy-ok" style="font-size:.78rem;color:#14532d;display:none">&#10003; Copied</span></div>'
					: '';

				content.innerHTML =
					'<div class="perm-error">' +
					'<strong>Some directories are not writable by the web server.</strong>' +
					listHtml +
					'<p style="font-size:.85rem;margin:.75rem 0;line-height:1.6">' +
					'Your web server needs write access to the directories marked above. ' +
					'How to fix this depends on your hosting environment - if you\'re unsure, contact your hosting provider or consult your control panel\'s file permissions settings.' +
					'</p>' +
					linuxBlock +
					'</div>';

				btnRechk.style.display = 'inline-block';

				if (fixCmd && el('btn-copy-fix')) {
					el('btn-copy-fix').addEventListener('click', function () {
						navigator.clipboard.writeText(fixCmd).then(() => {
							const ok = el('copy-ok');
							ok.style.display = 'inline';
							setTimeout(() => { ok.style.display = 'none'; }, 2000);
						});
					});
				}
			}
		} catch (e) {
			content.innerHTML = '<div class="perm-error"><strong>Permission check failed:</strong> ' + escH(e.message) + '</div>';
			btnRechk.style.display = 'inline-block';
		}
	}

	checkPermissions();

	el('btn-recheck').addEventListener('click', checkPermissions);

	el('btn-perm-continue').addEventListener('click', function () {
		markComplete(1);
		goToStep(2);
	});

	// ── Step 2: DB setup mode toggle ───────────────────────────────────────────
	// Most shared/cPanel-style hosts provision the database and its user
	// themselves and never hand out true MySQL root — the "root" account they
	// give a customer is really just that one database's own scoped user,
	// which typically can't CREATE USER or CREATE DATABASE (and doesn't need
	// to, since the host already did that). This toggle skips creation
	// entirely for that case and just verifies the credentials already work.
	function dbSetupMode() {
		return el('db_mode_existing').checked ? 'existing' : 'root';
	}

	function applyDbSetupMode() {
		const existing = dbSetupMode() === 'existing';
		el('root-creds-section').style.display   = existing ? 'none' : '';
		el('create-db-section').style.display     = existing ? 'none' : '';
		el('existing-db-section').style.display   = existing ? '' : 'none';

		// Step 3 changes meaning entirely in existing-db mode: it's no longer
		// creating anything, just confirming the customer's own credentials.
		el('step3-title').textContent    = existing ? 'Database Credentials' : 'Database User';
		el('step3-desc').textContent     = existing
			? "Enter the database username and password your host already gave you - this won't create or change anything."
			: 'Create a dedicated database user for EdgeCart. Safer than using root at runtime.';
		el('step3-subhead').textContent  = existing ? 'Your Database User' : 'New Database User';
		el('step3-user-hint').innerHTML  = existing ? 'The username your host already created.' : 'e.g. <code>new_cart</code>';
		el('btn-gen-db-pass').style.display = existing ? 'none' : '';
		el('btn-create-user').textContent   = existing ? 'Verify & Continue' : 'Create User & Continue';

		step2Check();
	}

	document.querySelectorAll('input[name="db_setup_mode"]').forEach(r => r.addEventListener('change', applyDbSetupMode));

	// ── Step 2: field validation ──────────────────────────────────────────────
	let credentialsVerified = false;

	function isValidDbName(v) {
		return /^[A-Za-z][A-Za-z0-9_]*$/.test(v);
	}

	function step2Check() {
		if (dbSetupMode() === 'existing') {
			el('btn-step1-next').disabled = !(val('db_host_existing') && isValidDbName(val('db_name_existing')));
			return;
		}
		el('btn-test-root').disabled  = !(val('db_host') && val('db_root'));
		el('btn-step1-next').disabled = !(credentialsVerified && isValidDbName(val('db_name_create')));
	}

	['db_host', 'db_root', 'db_rootpw'].forEach(id => {
		el(id).addEventListener('input', () => {
			if (credentialsVerified) {
				credentialsVerified = false;
				el('cred-ok').classList.remove('show');
				el('db_name_create').disabled = true;
				setInline('test-root-status', '', '');
			}
			step2Check();
		});
	});
	el('db_name_create').addEventListener('input', function () {
		// Strip disallowed characters as-typed, then any leading run of
		// digits/underscores — a MySQL identifier this field feeds into
		// must start with a letter.
		let v = this.value.replace(/[^A-Za-z0-9_]/g, '').replace(/^[^A-Za-z]+/, '');
		if (v !== this.value) this.value = v;
		step2Check();
	});
	['db_host_existing', 'db_name_existing'].forEach(id => {
		el(id).addEventListener('input', function () {
			if (this.id === 'db_name_existing') {
				let v = this.value.replace(/[^A-Za-z0-9_]/g, '').replace(/^[^A-Za-z]+/, '');
				if (v !== this.value) this.value = v;
			}
			step2Check();
		});
	});

	// applyDbSetupMode() calls step2Check() itself — this also has to run after
	// credentialsVerified is declared above, same reason it was moved out of
	// the mode-toggle wiring block earlier in the script.
	applyDbSetupMode();

	// ── Step 2: Test credentials ──────────────────────────────────────────────
	el('btn-test-root').addEventListener('click', async function () {
		setInline('test-root-status', '', '');
		setLoading(this, true);
		try {
			const res = await ajax({
				action:    'test_root',
				db_host:   val('db_host'),
				db_root:   val('db_root'),
				db_rootpw: pval('db_rootpw'),
			});
			setInline('test-root-status', res.message, res.ok ? 'ok' : 'error');
			if (res.ok) {
				credentialsVerified = true;
				el('cred-ok').classList.add('show');
				el('db_name_create').disabled = false;
			}
		} catch (e) {
			setInline('test-root-status', 'Request failed: ' + e.message, 'error');
		}
		setLoading(this, false);
		step2Check();
	});

	// ── Step 2: Continue ────────────────────────────────────────────────────────
	// Root mode: creates the database if it doesn't exist yet (silently no-ops
	// if it does) and only advances once that's confirmed to have worked.
	// Existing-db mode: nothing to create or test yet — there's no credentials
	// to test with until step 3, this just records the name/host the customer
	// already has and moves on.
	el('btn-step1-next').addEventListener('click', async function () {
		if (dbSetupMode() === 'existing') {
			el('db_host').value = val('db_host_existing');
			el('db_name').value = val('db_name_existing');
			markComplete(2);
			goToStep(3);
			return;
		}

		setInline('create-db-status', '', '');
		const dbName = val('db_name_create');
		setLoading(this, true);
		try {
			const res = await ajax({
				action:    'create_db',
				db_host:   val('db_host'),
				db_name:   dbName,
				db_root:   val('db_root'),
				db_rootpw: pval('db_rootpw'),
			});
			if (res.ok) {
				el('db_name').value = dbName;
				markComplete(2);
				goToStep(3);
			} else {
				setInline('create-db-status', res.message, 'error');
			}
		} catch (e) {
			setInline('create-db-status', 'Request failed: ' + e.message, 'error');
		}
		setLoading(this, false);
	});

	// ── Password policy: EdgeCart's own rule, not whatever the target MySQL
	// server happens to have configured ── The database step used to just check
	// "is this field non-empty" client-side and rely on MySQL's own
	// validate_password policy to reject anything weaker at CREATE USER time -
	// which meant the actual requirement (and whether one even existed) varied
	// silently by host, and a rejection surfaced as a raw driver error rather
	// than something explained up front. Mirrored exactly server-side in
	// ajax.php so neither side can drift from the other.
	function passwordPolicyCheck(pass) {
		const classes = [/[A-Z]/, /[a-z]/, /[0-9]/, /[^A-Za-z0-9]/];
		const met = classes.filter(re => re.test(pass)).length;
		return { lengthOk: pass.length >= 10, classesMet: met, ok: pass.length >= 10 && met >= 3 };
	}

	// ── Step 3: field validation ──────────────────────────────────────────────
	function step3Check() {
		const pass   = pval('db_pass');
		const policy = passwordPolicyCheck(pass);
		const hintEl = el('db-pass-policy');
		if (pass) {
			hintEl.textContent = policy.ok
				? '✓ Meets EdgeCart\'s password requirements'
				: `At least 10 characters and 3 of: uppercase, lowercase, numbers, symbols (currently ${pass.length} chars, ${policy.classesMet}/4 types)`;
			hintEl.className = 'hint ' + (policy.ok ? 'match-ok' : 'match-fail');
		} else {
			hintEl.textContent = 'At least 10 characters, including 3 of: uppercase, lowercase, numbers, symbols.';
			hintEl.className = 'hint';
		}
		el('btn-create-user').disabled = !(val('db_user') && policy.ok && val('db_name'));
	}

	['db_user', 'db_pass', 'db_prefix'].forEach(id => {
		el(id).addEventListener('input', step3Check);
	});

	step3Check();

	// ── Step 3: Create user (or, in existing-db mode, just verify) & continue ──
	el('btn-create-user').addEventListener('click', async function () {
		clearStatus();
		setLoading(this, true);
		try {
			const existing = dbSetupMode() === 'existing';
			const res = await ajax(existing ? {
				action:    'test_existing_db',
				db_host:   val('db_host'),
				db_name:   val('db_name'),
				db_user:   val('db_user'),
				db_pass:   pval('db_pass'),
				db_prefix: val('db_prefix'),
			} : {
				action:    'create_user',
				db_host:   val('db_host'),
				db_name:   val('db_name'),
				db_root:   val('db_root'),
				db_rootpw: pval('db_rootpw'),
				db_user:   val('db_user'),
				db_pass:   pval('db_pass'),
				db_prefix: val('db_prefix'),
			});
			if (res.ok) {
				setStatus(res.message, 'ok');
				markComplete(3);
				setTimeout(() => goToStep(4), 800);
			} else {
				setStatus(res.message, 'error');
				if (res.prefix_conflict) {
					el('db_prefix').focus();
					el('db_prefix').select();
				}
			}
		} catch (e) {
			setStatus('Request failed: ' + e.message, 'error');
		}
		setLoading(this, false);
	});

	// ── Admin password policy: at least 8 characters, a capital letter, a
	// number, and a special character - all required, checked here and
	// mirrored exactly by password_meets_admin_policy() server-side in
	// ajax.php, same reasoning as the database password policy above: shown
	// live as the customer types, not discovered only after submitting.
	function adminPasswordPolicyCheck(pass) {
		return {
			lengthOk:  pass.length >= 8,
			upperOk:   /[A-Z]/.test(pass),
			numberOk:  /[0-9]/.test(pass),
			specialOk: /[^A-Za-z0-9]/.test(pass),
		};
	}

	// ── Step 4: password match + field validation ─────────────────────────────
	function step4Check() {
		const user    = val('admin_user');
		const email   = val('admin_email');
		const pass    = pval('admin_pass');
		const confirm = pval('admin_confirm');
		const msgEl   = el('pw-match-msg');
		const polEl   = el('admin-pass-policy');

		const policy  = adminPasswordPolicyCheck(pass);
		const policyOk = policy.lengthOk && policy.upperOk && policy.numberOk && policy.specialOk;
		if (pass) {
			if (policyOk) {
				polEl.textContent = '✓ Meets password requirements';
				polEl.className   = 'hint match-ok';
			} else {
				const missing = [];
				if (!policy.lengthOk)  missing.push('at least 8 characters');
				if (!policy.upperOk)   missing.push('a capital letter');
				if (!policy.numberOk)  missing.push('a number');
				if (!policy.specialOk) missing.push('a special character');
				polEl.textContent = 'Still needs: ' + missing.join(', ') + '.';
				polEl.className   = 'hint match-fail';
			}
		} else {
			polEl.textContent = 'At least 8 characters, with a capital letter, a number, and a special character.';
			polEl.className   = 'hint';
		}

		let matchOk = false;
		if (pass && confirm) {
			if (pass === confirm) {
				msgEl.textContent = '✓ Passwords match';
				msgEl.className   = 'match-ok';
				matchOk = true;
			} else {
				msgEl.textContent = '✗ Passwords do not match';
				msgEl.className   = 'match-fail';
			}
		} else {
			msgEl.textContent = '';
			msgEl.className   = '';
		}

		el('btn-validate-admin').disabled = !(user.length >= 3 && email && policyOk && matchOk);
	}

	['admin_user', 'admin_email', 'admin_pass', 'admin_confirm'].forEach(id => {
		el(id).addEventListener('input', step4Check);
	});

	step4Check();

	// ── Step 4: Validate admin & continue ─────────────────────────────────────
	el('btn-validate-admin').addEventListener('click', async function () {
		clearStatus();
		setLoading(this, true);
		try {
			const res = await ajax({
				action:        'validate_admin',
				admin_user:    val('admin_user'),
				admin_email:   val('admin_email'),
				admin_pass:    pval('admin_pass'),
				admin_confirm: pval('admin_confirm'),
			});
			if (res.ok) {
				markComplete(4);
				setTimeout(() => goToStep(5), 300);
			} else {
				setStatus(res.message, 'error');
			}
		} catch (e) {
			setStatus('Request failed: ' + e.message, 'error');
		}
		setLoading(this, false);
	});

	// ── Step 5: field validation + admin path preview ─────────────────────────
	function step5Check() {
		el('btn-to-install').disabled = !(
			val('site_name') && val('site_currency') && val('site_email') && val('admin_path')
		);
	}

	['site_name', 'site_currency', 'site_email'].forEach(id => {
		el(id).addEventListener('input', step5Check);
	});
	el('admin_path').addEventListener('input', function () {
		el('admin-path-preview').textContent = this.value || 'admin';
		step5Check();
	});
	step5Check();

	step5Check();

	// ── Step 5: Continue ──────────────────────────────────────────────────────
	el('btn-to-install').addEventListener('click', function () {
		markComplete(5);
		goToStep(6);
	});

	// ── Step 6: Install ───────────────────────────────────────────────────────
	el('btn-install').addEventListener('click', async function () {
		clearStatus();
		setLoading(this, true);
		try {
			const res = await ajax({
				action:        'install',
				db_host:       val('db_host'),
				db_name:       val('db_name'),
				db_user:       val('db_user'),
				db_pass:       pval('db_pass'),
				db_prefix:     val('db_prefix'),
				admin_user:    val('admin_user'),
				admin_email:   val('admin_email'),
				admin_pass:    pval('admin_pass'),
				site_name:     val('site_name'),
				site_currency: val('site_currency'),
				site_email:        val('site_email'),
				admin_path:        val('admin_path'),
				sample_inventory:  '1',
				sample_customers:  '1',
			});
			if (res.ok) {
				markComplete(6);
				document.querySelectorAll('.step').forEach(s => s.style.display = 'none');
				el('step-nav').style.display  = 'none';
				el('status').style.display    = 'none';
				el('step-done').style.display = 'block';
				el('btn-go-admin').dataset.href = res.redirect || '/admin/';
				if (adminPassGenerated) {
					el('generated-pass-value').textContent = pval('admin_pass');
					el('generated-pass-reminder').style.display = 'block';
				}
			} else {
				setStatus(res.message, 'error');
			}
		} catch (e) {
			setStatus('Request failed: ' + e.message, 'error');
		}
		setLoading(this, false);
	});

	// ── Done ──────────────────────────────────────────────────────────────────
	el('btn-go-admin').addEventListener('click', function () {
		window.location.href = this.dataset.href || '/admin/';
	});

	// ── Back buttons ──────────────────────────────────────────────────────────
	el('btn-back-2').addEventListener('click', () => goBack(2));
	el('btn-back-3').addEventListener('click', () => goBack(3));
	el('btn-back-4').addEventListener('click', () => goBack(4));
	el('btn-back-5').addEventListener('click', () => goBack(5));
	el('btn-back-6').addEventListener('click', () => goBack(6));

})();
</script>

</body>
</html>

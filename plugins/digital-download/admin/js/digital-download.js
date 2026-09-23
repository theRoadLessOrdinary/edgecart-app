/**
 * Digital Downloads — product drawer JS
 */
(function() {

    function getProductId() {
        const el = document.getElementById('prod-id');
        return el ? parseInt(el.value, 10) : 0;
    }

    function ddTab() {
        return document.querySelector('.drawer-tab[data-panel="downloads"]');
    }

    function syncTabState(productId) {
        const tab = ddTab();
        if (!tab) return;
        if (productId) {
            tab.disabled = false;
            tab.title    = '';
        } else {
            tab.disabled = true;
            tab.title    = 'Save the product first';
        }
    }

    // ── Enable/disable tab whenever a product drawer tab activates ────────────
    document.addEventListener('nc-drawer-tab', function(e) {
        if (e.detail.page !== 'product') return;
        syncTabState(parseInt(e.detail.productId, 10) || 0);
        if (e.detail.panel === 'downloads') {
            // pendingFile is a single module-level variable shared across
            // every product's drawer — without resetting it here, a file
            // picked (but not yet uploaded) for one product would still show
            // as "pending" under the next product's Downloads tab, looking
            // like it had been uploaded/linked to the wrong product.
            setPendingFile(null);
            ddLoadFiles(parseInt(e.detail.productId, 10) || 0);
        }
    });

    // ── Pending file from drop or browse ──────────────────────────────────────
    let pendingFile = null;

    function setPendingFile(file) {
        pendingFile = file;
        const btn   = document.getElementById('dd-upload-btn');
        const label = document.getElementById('dd-drop-label');
        if (btn)   btn.disabled = !file;
        if (label) label.innerHTML = file
            ? '<strong>' + esc(file.name) + '</strong> &nbsp;·&nbsp; ' + fmtSize(file.size)
                + ' &nbsp;<label for="dd-file-input" style="color:var(--nc-primary);cursor:pointer;text-decoration:underline">change</label>'
            : 'Drop a file here, or <label for="dd-file-input" style="color:var(--nc-primary);cursor:pointer;text-decoration:underline">browse</label>';
    }

    // ── Drop zone ─────────────────────────────────────────────────────────────
    // These are bound at the document level (capturing) so they work
    // regardless of where in the drawer the drop lands, but that means they
    // were firing for ANY drag/drop on the page whenever #dd-drop-zone merely
    // *existed* in the DOM — including while it's hidden behind an inactive
    // tab (e.g. the Images tab). A file dropped on the Images drop zone was
    // also silently captured here as the Downloads tab's pending file. Gate
    // on offsetParent (null when the element or an ancestor is display:none)
    // so only an actually-visible drop zone responds.
    function ddZoneVisible() {
        const zone = document.getElementById('dd-drop-zone');
        return zone && zone.offsetParent !== null ? zone : null;
    }

    document.addEventListener('dragenter', function(e) {
        const zone = ddZoneVisible();
        if (!zone) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        zone._dragCount = (zone._dragCount || 0) + 1;
        zone.classList.add('drag-over');
        const label  = document.getElementById('dd-drop-label');
        const active = document.getElementById('dd-drop-active');
        if (label)  label.style.display  = 'none';
        if (active) active.style.display = '';
    }, true);

    document.addEventListener('dragleave', function(e) {
        const zone = ddZoneVisible();
        if (!zone) return;
        zone._dragCount = Math.max(0, (zone._dragCount || 1) - 1);
        if (zone._dragCount === 0) {
            zone.classList.remove('drag-over');
            const label  = document.getElementById('dd-drop-label');
            const active = document.getElementById('dd-drop-active');
            if (label)  label.style.display  = '';
            if (active) active.style.display = 'none';
        }
    }, true);

    document.addEventListener('dragover', function(e) {
        if (!ddZoneVisible()) return;
        e.preventDefault();
        // preventDefault() alone permits the drop, but some browsers still
        // show a "denied" cursor unless dropEffect is also set explicitly —
        // it's a separate signal from whether the drop is technically allowed.
        e.dataTransfer.dropEffect = 'copy';
    }, true);

    document.addEventListener('drop', function(e) {
        const zone = ddZoneVisible();
        if (!zone) return;
        e.preventDefault();
        zone._dragCount = 0;
        zone.classList.remove('drag-over');
        const label  = document.getElementById('dd-drop-label');
        const active = document.getElementById('dd-drop-active');
        if (label)  label.style.display  = '';
        if (active) active.style.display = 'none';
        if (e.dataTransfer.files.length) setPendingFile(e.dataTransfer.files[0]);
    }, true);

    // ── Browse (file input) ───────────────────────────────────────────────────
    document.addEventListener('change', function(e) {
        if (e.target.id !== 'dd-file-input') return;
        if (e.target.files.length) setPendingFile(e.target.files[0]);
    });

    // ── Upload button ─────────────────────────────────────────────────────────
    document.addEventListener('click', function(e) {
        if (!e.target.matches('#dd-upload-btn')) return;
        const productId = getProductId();
        if (!pendingFile) return;

        const btn = e.target;
        const fd  = new FormData();
        fd.append('action',     'dd_upload');
        fd.append('product_id', productId);
        fd.append('label',      (document.getElementById('dd-file-label')?.value || '').trim());
        fd.append('file',       pendingFile);
        fd.append('csrf_token', getCsrfToken());

        btn.disabled    = true;
        btn.textContent = 'Uploading…';

        fetch(NC.adminUrl + '?route=digital-download/ajax', { method: 'POST', body: fd })
            .then(r => r.json())
            .then(res => {
                btn.textContent = 'Upload';
                if (!res.ok) { btn.disabled = false; alert(res.message || 'Upload failed.'); return; }
                const labelInput = document.getElementById('dd-file-label');
                if (labelInput) labelInput.value = '';
                setPendingFile(null);
                ddLoadFiles(productId);
            });
    });

    // ── Delete ────────────────────────────────────────────────────────────────
    document.addEventListener('dip-confirm', function(e) {
        const row = e.target.closest('.dd-file-row');
        if (!row) return;
        const id = e.detail['data-id'];
        if (!id) return;

        const fd = new FormData();
        fd.append('action',     'dd_delete');
        fd.append('id',         id);
        fd.append('csrf_token', getCsrfToken());

        fetch(NC.adminUrl + '?route=digital-download/ajax', { method: 'POST', body: fd })
            .then(r => r.json())
            .then(res => {
                if (!res.ok) { alert(res.message || 'Delete failed.'); return; }
                ddLoadFiles(getProductId());
            });
    });

    // ── File list ─────────────────────────────────────────────────────────────
    function ddLoadFiles(productId) {
        const list = document.getElementById('dd-file-list');
        if (!list || !productId) return;

        const fd = new FormData();
        fd.append('action',     'dd_list');
        fd.append('product_id', productId);
        fd.append('csrf_token', getCsrfToken());

        fetch(NC.adminUrl + '?route=digital-download/ajax', { method: 'POST', body: fd })
            .then(r => r.json())
            .then(res => {
                if (!res.ok) { list.innerHTML = '<p class="hint">Could not load files.</p>'; return; }
                if (!res.files.length) { list.innerHTML = '<p class="hint">No files attached to this product.</p>'; return; }
                list.innerHTML = res.files.map(f => `
                    <div class="dd-file-row" style="display:flex;align-items:center;gap:.75rem;padding:.5rem 0;border-bottom:1px solid var(--nc-border-light)">
                        <span style="flex:1;font-size:.9rem">${esc(f.label || f.filename)}
                            <br><small style="color:var(--nc-text-dim)">${esc(f.filename)} &nbsp;·&nbsp; ${fmtSize(f.filesize)}</small>
                        </span>
                        <delete-in-place data-id="${f.id}" caption="🗑" confirm="OK?"></delete-in-place>
                    </div>`).join('');
            });
    }

    function esc(s) {
        return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    function fmtSize(bytes) {
        bytes = parseInt(bytes, 10) || 0;
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1048576).toFixed(1) + ' MB';
    }

})();

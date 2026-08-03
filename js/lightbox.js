/*
	Lightbox for the /you/ meet-and-greet galleries.

	Clicking a thumbnail opens the full photograph over the page instead of
	navigating to a page of its own. Progressive enhancement throughout: the
	thumbnails are ordinary links to the JPEG carrying a download attribute, so
	with this script blocked a click still gets the visitor their photo.

	Deliberately no prev/next stepping - one photo at a time, close to pick
	another. Clicking the photograph downloads it, matching what the per-photo
	pages have always done, so the controls sit clear of the image rather than
	on top of it where they would swallow that click.
*/
(function () {
	'use strict';

	var grid = document.getElementById('youimages');
	if (!grid) return;

	var CLOSE_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">' +
		'<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M5 5l14 14M19 5L5 19"/></svg>';
	var SAVE_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">' +
		'<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
		'd="M12 3v11m0 0l-4.2-4.2M12 14l4.2-4.2M4.5 17.5v1.2A2.3 2.3 0 006.8 21h10.4a2.3 2.3 0 002.3-2.3v-1.2"/></svg>';

	var box, inner, photoLink, photoImg, note, saveLink, closeBtn;
	var lastFocus = null;
	var pushedState = false;

	function build() {
		box = document.createElement('div');
		box.className = 'lightbox';
		box.hidden = true;
		box.innerHTML =
			'<div class="lightboxInner" role="dialog" aria-modal="true" aria-label="Photograph">' +
				'<div class="lightboxStage">' +
					'<a class="lightboxPhoto" download><img alt=""></a>' +
					'<p class="lightboxNote" hidden>This photograph isn\u2019t available right now. Please email ' +
						'<a href="mailto:david@davidconger.com">david@davidconger.com</a> and I\u2019ll send it over.</p>' +
				'</div>' +
				'<div class="lightboxTools">' +
					'<button type="button" class="lightboxBtn lightboxClose" title="Close" aria-label="Close">' + CLOSE_ICON + '</button>' +
					'<a class="lightboxBtn lightboxSave" download title="Download this photograph" aria-label="Download this photograph">' + SAVE_ICON + '</a>' +
				'</div>' +
			'</div>';

		inner = box.querySelector('.lightboxInner');
		photoLink = box.querySelector('.lightboxPhoto');
		photoImg = photoLink.querySelector('img');
		note = box.querySelector('.lightboxNote');
		saveLink = box.querySelector('.lightboxSave');
		closeBtn = box.querySelector('.lightboxClose');

		closeBtn.addEventListener('click', function () { close(); });

		// Anywhere outside the dialog is a dismiss target. The photograph and
		// the controls stop the event reaching here.
		box.addEventListener('click', function (e) {
			if (!inner.contains(e.target)) close();
		});

		photoImg.addEventListener('load', function () {
			inner.classList.remove('isLoading');
		});
		photoImg.addEventListener('error', function () {
			inner.classList.remove('isLoading');
			inner.classList.add('isMissing');
			photoLink.hidden = true;
			note.hidden = false;
			saveLink.hidden = true;
		});

		document.body.appendChild(box);
	}

	function onKeydown(e) {
		if (e.key === 'Escape') { e.preventDefault(); close(); return; }
		if (e.key !== 'Tab') return;

		// Keep focus inside the dialog while it is open.
		var focusable = [];
		var all = inner.querySelectorAll('a[href], button');
		for (var i = 0; i < all.length; i++) {
			if (!all[i].hidden && all[i].offsetParent !== null) focusable.push(all[i]);
		}
		if (!focusable.length) return;
		var first = focusable[0];
		var last = focusable[focusable.length - 1];
		if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
		else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
	}

	function open(anchor) {
		if (!box) build();

		var url = anchor.getAttribute('href');
		var thumb = anchor.querySelector('img');
		var w = anchor.getAttribute('data-full-width');
		var h = anchor.getAttribute('data-full-height');

		inner.classList.remove('isMissing');
		inner.classList.add('isLoading');
		photoLink.hidden = false;
		note.hidden = true;
		saveLink.hidden = false;

		// Set the intrinsic size before the source so the frame reserves the
		// right shape and the photograph does not shove the controls around
		// as it arrives.
		if (w && h) { photoImg.width = w; photoImg.height = h; }
		else { photoImg.removeAttribute('width'); photoImg.removeAttribute('height'); }

		photoImg.alt = thumb ? thumb.getAttribute('alt') || '' : '';
		photoImg.src = url;
		photoLink.href = url;
		saveLink.href = url;

		lastFocus = document.activeElement;
		box.hidden = false;
		document.documentElement.classList.add('lightboxOpen');
		document.addEventListener('keydown', onKeydown);
		closeBtn.focus();

		// So the hardware back button dismisses the photograph rather than
		// leaving the gallery, which is what people expect on a phone.
		if (window.history && window.history.pushState) {
			try { window.history.pushState({ lightbox: true }, ''); pushedState = true; } catch (err) { pushedState = false; }
		}
	}

	function teardown() {
		if (!box || box.hidden) return;
		box.hidden = true;
		document.documentElement.classList.remove('lightboxOpen');
		document.removeEventListener('keydown', onKeydown);
		// Stop a large download that is still in flight.
		photoImg.removeAttribute('src');
		if (lastFocus && lastFocus.focus) lastFocus.focus();
		lastFocus = null;
	}

	function close() {
		if (!box || box.hidden) return;
		if (pushedState) {
			pushedState = false;
			window.history.back(); // popstate runs teardown
			return;
		}
		teardown();
	}

	window.addEventListener('popstate', function () {
		pushedState = false;
		teardown();
	});

	grid.addEventListener('click', function (e) {
		// Leave modified and non-primary clicks to the browser so "open in new
		// tab" and "save link as" keep working.
		if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
		var anchor = e.target.closest ? e.target.closest('a[href]') : null;
		if (!anchor || !grid.contains(anchor)) return;
		if (!/\.jpe?g($|\?)/i.test(anchor.getAttribute('href') || '')) return;
		e.preventDefault();
		open(anchor);
	});

	// A retired per-photo URL can be redirected to the gallery with #p-NN and
	// land on the right photograph.
	function openFromHash() {
		if (box && !box.hidden) return;
		var hash = window.location.hash;
		if (!/^#p-\w+$/.test(hash)) return;
		var li = document.getElementById(hash.slice(1));
		if (!li || !grid.contains(li)) return;
		var anchor = li.querySelector('a[href]');
		if (anchor) open(anchor);
	}
	window.addEventListener('hashchange', openFromHash);
	openFromHash();
})();

/* --------------------------------------------------------------------------
   Year stream rotator

   One delegated listener for the whole page rather than one per show: a year
   can carry eighty shows, and eighty sets of listeners is eighty sets of
   listeners.

   The markup is complete and correct with this file absent -- the first frame
   is already the active one and every caption is a link to the gallery -- so
   the rotator is an enhancement, not a dependency.
   -------------------------------------------------------------------------- */
(function () {
	'use strict';

	function select(show, index) {
		var slides = show.querySelectorAll('.showSlide');
		var dots = show.querySelectorAll('.showDots button');
		for (var i = 0; i < slides.length; i++) {
			var on = i === index;
			slides[i].classList.toggle('is-active', on);
			// Only the visible frame should be reachable by keyboard or read
			// out, otherwise every show becomes three or four stops in the tab
			// order for one destination.
			var link = slides[i].querySelector('.showCaption');
			if (on) {
				slides[i].removeAttribute('aria-hidden');
				if (link) link.removeAttribute('tabindex');
			} else {
				slides[i].setAttribute('aria-hidden', 'true');
				if (link) link.setAttribute('tabindex', '-1');
			}
			if (dots[i]) dots[i].setAttribute('aria-selected', String(on));
		}
	}

	function advanceBy(show, step) {
		var slides = show.querySelectorAll('.showSlide');
		if (slides.length < 2) return;
		var current = 0;
		for (var i = 0; i < slides.length; i++) {
			if (slides[i].classList.contains('is-active')) current = i;
		}
		select(show, (current + step + slides.length) % slides.length);
	}

	document.addEventListener('click', function (e) {
		if (!e.target.closest) return;

		var dot = e.target.closest('.showDots button');
		if (dot) {
			var dotShow = dot.closest('.show');
			if (!dotShow) return;
			select(dotShow, Number(dot.getAttribute('data-index')) || 0);
			hold(dotShow);
			return;
		}

		// Clicking the photograph shows the next photograph. The caption is
		// the link out to the gallery, so anything inside it is left alone.
		if (e.target.closest('.showCaption')) return;
		var frame = e.target.closest('.showFrame');
		if (!frame) return;
		var show = frame.closest('.show');
		if (!show) return;
		advanceBy(show, 1);
		hold(show);
	});

	// Somewhere a keystroke would land in text rather than on the page.
	function isTyping(node) {
		if (!node || !node.tagName) return false;
		if (node.isContentEditable) return true;
		return /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName);
	}

	// Left/right within a rotator, so it is usable without a mouse.
	document.addEventListener('keydown', function (e) {
		if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
		// Alt+Left is history, and the other combinations belong to the browser.
		if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
		if (isTyping(e.target)) return;

		var step = e.key === 'ArrowRight' ? 1 : -1;
		var dot = e.target.closest ? e.target.closest('.showDots button') : null;

		if (dot) {
			var dots = dot.parentNode.querySelectorAll('button');
			var i = Number(dot.getAttribute('data-index')) || 0;
			var next = (i + step + dots.length) % dots.length;
			e.preventDefault();
			select(dot.closest('.show'), next);
			dots[next].focus();
			hold(dot.closest('.show'));
			return;
		}

		/* The home page is one photograph, so the arrow keys can belong to it
		   outright -- there is nothing else on the page they could mean. A year
		   page carries eighty shows and no such answer, so there the arrows stay
		   with the browser and only the focused dot strip above responds. */
		var home = document.querySelector('.homeGrid .show');
		if (!home || home.hasAttribute('hidden')) return;
		if (home.querySelectorAll('.showSlide').length < 2) return;
		e.preventDefault();
		advanceBy(home, step);
		hold(home);
	});

	/* ----------------------------------------------------------------------
	   Ambient motion

	   A page of eighty still frames is inert, but eighty rotators all turning
	   at once is a slot machine. So exactly one show changes at a time, chosen
	   at random from those actually on screen, every few seconds.

	   Deliberately excluded from the draw: shows scrolled out of view, since
	   nobody is watching them; the show under the pointer, since a photograph
	   should not swap itself out from under someone looking at it; and any
	   show whose rotator was just driven by hand, for a spell afterwards.
	   ---------------------------------------------------------------------- */

	var TICK_MS = 3200;
	var HOLD_MS = 20000;
	var onScreen = [];
	var held = new WeakMap();
	var lastPicked = null;
	var observer = null;
	var watched = new WeakSet();
	var ticking = null;

	function hold(show) {
		held.set(show, Date.now() + HOLD_MS);
	}

	function eligible(show) {
		if (held.get(show) > Date.now()) return false;
		if (show.matches(':hover')) return false;
		// Someone tabbing through the rotator is using it; leave it alone.
		return !show.contains(document.activeElement);
	}

	function tick() {
		if (document.hidden || !onScreen.length) return;
		var pool = onScreen.filter(eligible);
		if (!pool.length) return;
		// Avoid repeating the previous pick while anything else is available,
		// so the movement reads as scattered rather than as one busy frame.
		if (pool.length > 1 && lastPicked) {
			var others = pool.filter(function (s) { return s !== lastPicked; });
			if (others.length) pool = others;
		}
		lastPicked = pool[Math.floor(Math.random() * pool.length)];
		advanceBy(lastPicked, 1);
	}

	function start() {
		var shows = document.querySelectorAll('.show');
		if (!shows.length) return;

		if (window.IntersectionObserver) {
			if (!observer) {
				observer = new IntersectionObserver(function (entries) {
					entries.forEach(function (entry) {
						var at = onScreen.indexOf(entry.target);
						// Half the frame has to be showing to qualify, so a show
						// clipped by the fold does not change while half hidden.
						if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
							if (at < 0) onScreen.push(entry.target);
						} else if (at > -1) {
							onScreen.splice(at, 1);
						}
					});
				}, { threshold: [0, 0.5, 1] });
			}
			for (var i = 0; i < shows.length; i++) {
				if (watched.has(shows[i])) continue;
				if (shows[i].querySelectorAll('.showDots button').length > 1) {
					watched.add(shows[i]);
					observer.observe(shows[i]);
				}
			}
		}

		if (ticking === null) ticking = setInterval(tick, TICK_MS);
	}

	// Someone who has asked for less movement gets the page without any.
	var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
	var still = !!(calm && calm.matches);
	if (!still) start();

	/* The home page builds its rotator from JSON after this file has already
	   run, so it needs a way to say "there is a show now". Everything else --
	   clicks, dots, keyboard -- is delegated from the document and works on
	   markup that did not exist at load; only the intersection observer and the
	   ambient timer have to be told. */
	window.dcStream = {
		refresh: function () { if (!still) start(); }
	};

	/* ----------------------------------------------------------------------
	   Sticky chrome

	   Both bands pin themselves with position:sticky, which needs no help.
	   What does need help is knowing when they are pinned, so the utility bar
	   can take on the masthead and the year bar can raise a background against
	   the photographs sliding under it. A sentinel above each one answers that
	   without listening to scroll.
	   ---------------------------------------------------------------------- */

	function watchStick(target, trigger, className, offset) {
		if (!target || !trigger) return;
		if (!window.IntersectionObserver) return;
		new IntersectionObserver(function (entries) {
			target.classList.toggle(className, !entries[0].isIntersecting);
		}, { rootMargin: '-' + offset + 'px 0px 0px 0px', threshold: 0 }).observe(trigger);
	}

	var topBar = document.querySelector('.streamTopBar');
	var masthead = document.querySelector('.streamHeader');
	var yearBar = document.querySelector('.yearBar');
	var barHeight = topBar ? topBar.offsetHeight : 52;

	/* ----------------------------------------------------------------------
	   What the collapsed bar says on a gallery page

	   Everywhere else the bar takes over the masthead, because the masthead is
	   what scrolled away. On a gallery the thing that scrolled away is the
	   show, and by then the site's identity has already been established twice
	   over -- by the home icon, the crumb, and the page you came from. So the
	   bar carries the show instead: who played, where, and when.

	   The venue keeps only its own name. "WaMu Theater, Seattle, WA" is three
	   facts, and two of them are the same on almost every page here.
	   ---------------------------------------------------------------------- */

	function lastYear(text) {
		var found = String(text).match(/\b(?:19|20)\d{2}\b/g);
		return found ? found[found.length - 1] : '';
	}

	function venueName(text) {
		return String(text).split(',')[0].trim();
	}

	/* A line is the date if it names a month and carries a year. Both are
	   required: "Marymoor Park, Redmond, WA" names no month, and "Deck The
	   Hall Ball 2011" names no month either. */
	var MONTH = /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i;

	function isDateLine(line) {
		return MONTH.test(line) && !!lastYear(line);
	}

	/* The block's lines in order, breaking at every <br>, dropping the title
	   where there is one, and stopping at the small print where there is one. */
	function looseLines(details, dropEl, stopEl) {
		var lines = [];
		var line = '';
		var kids = details.childNodes;
		for (var i = 0; i < kids.length; i++) {
			var node = kids[i];
			if (stopEl && node === stopEl) break;
			if (node === dropEl || (node.nodeType === 1 && node.tagName === 'BR')) {
				lines.push(line.trim());
				line = '';
				continue;
			}
			line += node.textContent;
		}
		lines.push(line.trim());
		return lines.filter(Boolean);
	}

	/* The 2009-2012 pages predate the generator that gave each fact its own
	   element. There the block is loose text broken by <br>, in a fixed order:
	   the act, sometimes the tour, then the venue -- and after that a
	   small-print span holding the supporting acts and the date. That span is
	   the seam. Everything before it ends on the venue, and the year is the
	   last one inside it, which is how "Cage The Elephant at Key Arena" comes
	   out of a page whose small print lists six other bands and whose tour line
	   is called Deck The Hall Ball 2011. */
	function showParts(details) {
		var titleEl = details.querySelector('#title');
		var venueEl = details.querySelector('#venue');
		var dateEl = details.querySelector('#date');
		var small = details.querySelector('.style1');

		var artist = titleEl ? titleEl.textContent.trim() : '';
		var venue = venueEl ? venueName(venueEl.textContent) : '';
		var year = dateEl ? lastYear(dateEl.textContent) : '';

		if (!artist || !venue || !year) {
			var lines = looseLines(details, titleEl, small);

			// A handful of pages never had their act promoted to a heading and
			// still open with it as bare text, which puts it on the first line.
			if (!artist) artist = lines.shift() || '';
			if (!year) year = lastYear(small ? small.textContent : details.textContent);

			if (!venue && lines.length) {
				var last = lines[lines.length - 1];
				if (!small && isDateLine(last)) {
					// No small print to stop at, so the date is still in hand
					// and the venue is the line above it.
					if (!year) year = lastYear(last);
					venue = lines.length > 1 ? venueName(lines[lines.length - 2]) : '';
				} else {
					venue = venueName(last);
				}
			}
		}

		if (!artist || (!venue && !year)) return null;
		return {
			artist: artist,
			rest: (venue ? 'at ' + venue : '') + (venue && year ? ', ' : '') + year
		};
	}

	var details = document.querySelector('.galleryPage #gallery #details');
	var brand = document.querySelector('.brandCompact');
	var parts = details && brand ? showParts(details) : null;

	if (parts) {
		var name = document.createElement('span');
		name.className = 'brandCompactName';
		name.textContent = parts.artist;

		brand.textContent = '';
		brand.appendChild(name);
		if (parts.rest) brand.appendChild(document.createTextNode(' ' + parts.rest));

		// Narrow windows clip the line with an ellipsis, so the whole of it
		// stays available to a pointer.
		brand.title = (parts.artist + ' ' + parts.rest).trim();
	}

	// The bar carries no fill until it collapses, so the masthead scrolls all
	// the way to the top of the window rather than vanishing 50px early behind
	// it. The handover happens when the name itself starts to leave: the line
	// above it is what gets watched, because that line's bottom edge is the
	// name's top edge. The inset matches the gap the icons keep from the top of
	// the window -- half the difference between the bar's height and the icons
	// -- so the name reaches the same place they sit before it goes.
	watchStick(topBar, document.querySelector('.headerTextPre'), 'is-collapsed', 15);

	// The year pins as soon as it reaches the bar, which is the moment the
	// masthead -- the last thing above it -- has passed the bar's full height.
	watchStick(yearBar, masthead, 'is-stuck', barHeight);

	/* ------------------------------------------------------------------
	   Year picker

	   The year in the bar is also the door to every other year. Opening it
	   is meant to feel like the label unfolding rather than a menu
	   arriving, so the row for the year you are on is placed over the
	   label it came from and the rest of the years appear around it.

	   That placement is measured rather than calculated. The label and the
	   rows are different elements at different sizes inside a bar that
	   changes height when it pins, so the reliable way to land one on the
	   other is to open the list, scroll it, then read both boxes and shift
	   the list by the difference. Everything about the list is
	   fixed-height for the same reason: nothing may change its geometry
	   while it is open, or the year slides off its own label.
	   ------------------------------------------------------------------ */
	var pick = document.querySelector('.yearPick');
	var label = pick && pick.querySelector('.yearLabel');
	var menu = pick && pick.querySelector('.yearMenu');
	var list = pick && pick.querySelector('.yearMenuList');

	if (pick && label && menu && list) {
		var current = menu.querySelector('.yearMenuItem.is-current');
		var fadeUp = menu.querySelector('.yearMenuStep.is-up');
		var fadeDown = menu.querySelector('.yearMenuStep.is-down');
		var stops = [].slice.call(menu.querySelectorAll('.yearMenuItem, .yearMenuAll'));
		var open = false;

		function fades() {
			var top = list.scrollTop > 1;
			var bottom = list.scrollTop + list.clientHeight < list.scrollHeight - 1;
			if (fadeUp) fadeUp.classList.toggle('is-off', !top);
			if (fadeDown) fadeDown.classList.toggle('is-off', !bottom);
		}

		// Centre the year you are on where it can be centred, and let it sit at
		// the top or the bottom of the list at the two ends of the archive --
		// which is the truth of where you are, and the arrows say the same.
		function place() {
			menu.style.top = '0px';
			menu.style.transform = 'translateX(-50%)';

			var anchor = current || stops[0];
			if (anchor) {
				// Relative to the list's own box rather than offsetTop, which is
				// measured from the menu and so carries the menu's padding and
				// the scroll hint above the list with it.
				list.scrollTop += (anchor.getBoundingClientRect().top - list.getBoundingClientRect().top)
					- (list.clientHeight - anchor.offsetHeight) / 2;
			}
			fades();
			if (!anchor) return;

			var a = anchor.getBoundingClientRect();
			var l = label.getBoundingClientRect();
			menu.style.top = (l.top - a.top) + 'px';
			menu.style.transform = 'translateX(calc(-50% + '
				+ ((l.left + l.width / 2) - (a.left + a.width / 2)) + 'px))';
		}

		function show() {
			if (open) return;
			open = true;
			menu.hidden = false;
			place();
			// The class is set on the next frame so the fade actually runs;
			// applied in the same frame as `hidden` coming off, there is no
			// starting value to animate from.
			requestAnimationFrame(function () { menu.classList.add('is-open'); });
			label.setAttribute('aria-expanded', 'true');
		}

		function hide(refocus) {
			if (!open) return;
			open = false;
			menu.classList.remove('is-open');
			menu.hidden = true;
			label.setAttribute('aria-expanded', 'false');
			if (refocus) label.focus();
		}

		function step(dir) {
			var here = stops.indexOf(document.activeElement);
			if (here < 0) here = current ? stops.indexOf(current) : 0;
			var next = stops[Math.min(stops.length - 1, Math.max(0, here + dir))];
			if (next) next.focus();
		}

		label.setAttribute('aria-expanded', 'false');
		label.setAttribute('aria-controls', menu.id || 'yearMenu');

		label.addEventListener('click', function (e) {
			// A modifier click on a link means "somewhere else", and the link
			// still points at the list of every year, so leave it alone.
			if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
			e.preventDefault();
			if (open) hide(false); else { show(); if (current) current.focus(); }
		});

		label.addEventListener('keydown', function (e) {
			if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
			e.preventDefault();
			show();
			if (current) current.focus();
		});

		menu.addEventListener('keydown', function (e) {
			if (e.key === 'Escape') { e.preventDefault(); hide(true); return; }
			if (e.key === 'ArrowDown') { e.preventDefault(); step(1); return; }
			if (e.key === 'ArrowUp') { e.preventDefault(); step(-1); return; }
			if (e.key === 'Home') { e.preventDefault(); stops[0].focus(); return; }
			if (e.key === 'End') { e.preventDefault(); stops[stops.length - 1].focus(); return; }
			// Tab is a deliberate move out of the list rather than a mistake,
			// so it closes without stealing the focus back.
			if (e.key === 'Tab') hide(false);
		});

		list.addEventListener('scroll', fades);

		[fadeUp, fadeDown].forEach(function (fade, i) {
			if (!fade) return;
			fade.addEventListener('click', function () {
				list.scrollBy({ top: (i ? 3 : -3) * list.clientHeight / 5, behavior: 'smooth' });
			});
		});

		document.addEventListener('pointerdown', function (e) {
			if (open && !pick.contains(e.target)) hide(false);
		});

		document.addEventListener('focusin', function (e) {
			if (open && !pick.contains(e.target)) hide(false);
		});

		// The bar changes height as it pins and the list is anchored to a
		// measurement taken before that, so it closes rather than drifting off
		// the label. Scrolling the list itself does not reach this handler.
		window.addEventListener('scroll', function () { hide(false); }, { passive: true });
		window.addEventListener('resize', function () { hide(false); });
	}
}());

/* --------------------------------------------------------------------------
   PROTOTYPE -- year stream rotator

   One delegated listener for the whole page rather than one per show: a year
   can carry eighty shows, and eighty sets of listeners is eighty sets of
   listeners.

   The markup is complete and correct with this file absent -- the first frame
   is already the active one and every slide is a link to the gallery -- so the
   rotator is an enhancement, not a dependency.
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
			if (on) {
				slides[i].removeAttribute('tabindex');
				slides[i].removeAttribute('aria-hidden');
			} else {
				slides[i].setAttribute('tabindex', '-1');
				slides[i].setAttribute('aria-hidden', 'true');
			}
			if (dots[i]) dots[i].setAttribute('aria-selected', String(on));
		}
	}

	document.addEventListener('click', function (e) {
		var dot = e.target.closest ? e.target.closest('.showDots button') : null;
		if (!dot) return;
		var show = dot.closest('.show');
		if (!show) return;
		select(show, Number(dot.getAttribute('data-index')) || 0);
		hold(show);
	});

	// Left/right within a rotator, so it is usable without a mouse.
	document.addEventListener('keydown', function (e) {
		if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
		var dot = e.target.closest ? e.target.closest('.showDots button') : null;
		if (!dot) return;
		var dots = dot.parentNode.querySelectorAll('button');
		var i = Number(dot.getAttribute('data-index')) || 0;
		var next = (i + (e.key === 'ArrowRight' ? 1 : dots.length - 1)) % dots.length;
		e.preventDefault();
		select(dot.closest('.show'), next);
		dots[next].focus();
		hold(dot.closest('.show'));
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

	function hold(show) {
		held.set(show, Date.now() + HOLD_MS);
	}

	function advance(show) {
		var dots = show.querySelectorAll('.showDots button');
		if (dots.length < 2) return;
		var current = 0;
		for (var i = 0; i < dots.length; i++) {
			if (dots[i].getAttribute('aria-selected') === 'true') { current = i; break; }
		}
		select(show, (current + 1) % dots.length);
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
		advance(lastPicked);
	}

	function start() {
		var shows = document.querySelectorAll('.show');
		if (!shows.length) return;

		if (window.IntersectionObserver) {
			var io = new IntersectionObserver(function (entries) {
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
			for (var i = 0; i < shows.length; i++) {
				if (shows[i].querySelectorAll('.showDots button').length > 1) io.observe(shows[i]);
			}
		}

		setInterval(tick, TICK_MS);
	}

	// Someone who has asked for less movement gets the page without any.
	var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
	if (!calm || !calm.matches) start();

	/* ----------------------------------------------------------------------
	   Sticky chrome

	   Both bands pin themselves with position:sticky, which needs no help.
	   What does need help is knowing when they are pinned, so the utility bar
	   can take on the masthead and the year bar can raise a background against
	   the photographs sliding under it. A sentinel above each one answers that
	   without listening to scroll.
	   ---------------------------------------------------------------------- */

	function watchStick(target, trigger, className) {
		if (!target || !trigger) return;
		if (!window.IntersectionObserver) return;
		var bar = document.querySelector('.streamTopBar');
		var offset = bar ? bar.offsetHeight : 52;
		new IntersectionObserver(function (entries) {
			target.classList.toggle(className, !entries[0].isIntersecting);
		}, { rootMargin: '-' + offset + 'px 0px 0px 0px', threshold: 0 }).observe(trigger);
	}

	var topBar = document.querySelector('.streamTopBar');
	var masthead = document.querySelector('.streamHeader');
	var yearBar = document.querySelector('.yearBar');

	// The bar collapses once the masthead has gone by, not before: until then
	// the full masthead is on screen and repeating it in the bar is noise.
	watchStick(topBar, masthead, 'is-collapsed');

	// The year bar's own top edge is where it would sit unpinned, so the title
	// block above it is the thing to watch.
	watchStick(yearBar, document.querySelector('.streamTitle'), 'is-stuck');
}());

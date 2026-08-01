/* --------------------------------------------------------------------------
   PROTOTYPE -- year stream rotator

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
}());

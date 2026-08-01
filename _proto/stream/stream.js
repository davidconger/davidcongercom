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
	});
}());

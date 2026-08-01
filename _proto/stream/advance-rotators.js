// Advances every rotator on the page by one frame, so a screenshot shows the
// second photograph of each show rather than the state the page loads in.
document.querySelectorAll('.show').forEach(function (show) {
	var dots = show.querySelectorAll('.showDots button');
	if (dots.length > 1) dots[1].click();
});
document.title = document.querySelectorAll('.showSlide.is-active').length + ' active slides';

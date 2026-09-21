/* global document */
const video = document.querySelector('#attention-demo');
const playButton = document.querySelector('.demo-play');
const playLabel = document.querySelector('[data-play-label]');
if (video && playButton && playLabel) {
  playButton.hidden = false;
  playButton.addEventListener('click', async () => {
    if (video.ended) video.currentTime = 0;
    try {
      await video.play();
    } catch {
      playLabel.textContent = 'Try playing again';
      playButton.hidden = false;
    }
  });
  video.addEventListener('play', () => {
    playButton.hidden = true;
  });
  video.addEventListener('pause', () => {
    if (video.currentTime > 0 && !video.ended) playButton.hidden = true;
  });
  video.addEventListener('ended', () => {
    playLabel.textContent = 'Watch again';
    playButton.hidden = false;
  });
}

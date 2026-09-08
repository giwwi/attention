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
      // Native controls and a direct MP4 link remain available if playback fails.
      playLabel.textContent = 'Try playing again';
      playButton.hidden = false;
    }
  });
  video.addEventListener('play', () => {
    playButton.hidden = true;
  });
  video.addEventListener('pause', () => {
    // Native controls resume playback without covering the frame or captions.
    playButton.hidden = true;
  });
  video.addEventListener('ended', () => {
    playLabel.textContent = 'Watch again';
    playButton.hidden = false;
  });
  // No autoplay, even without reduced-motion. Motion always follows a play action.
}

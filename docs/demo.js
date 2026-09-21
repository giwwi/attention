/* global document */
const video = document.querySelector('#attention-demo');
const playButton = document.querySelector('.demo-play');
const playLabel = document.querySelector('[data-play-label]');
const download = document.querySelector('.demo-download');
const languageButtons = document.querySelectorAll('[data-video-language]');
if (video && playButton && playLabel) {
  let language = 'en';
  playButton.hidden = false;
  playButton.addEventListener('click', async () => {
    if (video.ended) video.currentTime = 0;
    try {
      await video.play();
    } catch {
      playLabel.textContent =
        language === 'ru' ? 'Попробовать ещё раз' : 'Try playing again';
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
    playLabel.textContent =
      language === 'ru' ? 'Посмотреть снова' : 'Watch again';
    playButton.hidden = false;
  });
  languageButtons.forEach((button) =>
    button.addEventListener('click', () => {
      const next = button.dataset.videoLanguage;
      if (next === language || !['en', 'ru'].includes(next)) return;
      language = next;
      video.pause();
      video.src = `./media/attention-your-context-${language}.mp4`;
      video.setAttribute(
        'aria-label',
        language === 'ru'
          ? 'Attention: перенеси профиль и сам выбирай, что читать'
          : 'Attention: bring your profile and choose what to read',
      );
      const track = video.querySelector('track');
      track.src = `./media/attention-your-context-${language}.vtt`;
      track.srclang = language;
      track.label = language === 'ru' ? 'Русский' : 'English';
      video.load();
      download.href = video.src;
      languageButtons.forEach((choice) =>
        choice.setAttribute('aria-pressed', String(choice === button)),
      );
      playLabel.textContent =
        language === 'ru'
          ? 'Смотреть с русской озвучкой'
          : 'Watch the transfer';
      playButton.hidden = false;
    }),
  );
}

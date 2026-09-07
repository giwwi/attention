/* global document */
// An explanation of the four actions, not a simulated article assessment.
const choices = {
  read: [
    'Give a good fit your full attention.',
    'See the recommendation, the reason, and the reading time together. Then decide whether to dive in.',
  ],
  skim: [
    'Go straight to the useful parts.',
    'Use the reading guidance to find sections worth a closer look when you don’t need the whole article.',
  ],
  save: [
    'Worth reading. Just not right now.',
    'Keep the article in Attention’s saved list. Come back when you have the time or the right question.',
  ],
  skip: [
    'Leave room for something better.',
    'Pass on an article that doesn’t fit this moment. Attention suggests; you decide what deserves your time.',
  ],
};
const heading = document.querySelector('#decision-heading');
const copy = document.querySelector('#decision-copy');
const buttons = document.querySelectorAll('[data-decision]');
if (heading && copy) {
  for (const button of buttons) {
    button.addEventListener('click', () => {
      const choice = choices[button.dataset.decision];
      if (!choice) return;
      for (const item of buttons)
        item.setAttribute('aria-pressed', String(item === button));
      heading.textContent = choice[0];
      copy.textContent = choice[1];
    });
  }
}

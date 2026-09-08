/* global document */
// Product guidance; the website does not analyze the visitor's articles.
const choices = {
  preview: [
    'A first signal before you open.',
    'Hover over an article link in your feed for a first indication of whether it fits your interests. Open the article for a fuller assessment.',
  ],
  focus: [
    'Useful passages. With their context.',
    'Jump to passages that fit your goal, with the surrounding explanation. Move between them and say what you already knew. If no useful match is found, Attention says so.',
  ],
  save: [
    'Worth reading. Just not right now.',
    'Save the article to Attention’s reading list and see confirmation immediately. Come back when you are ready.',
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

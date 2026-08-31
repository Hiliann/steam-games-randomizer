// Public demo only. Never contacts the user's local Steam randomizer.
export const demoGames = Object.freeze([
  { title: 'Северный свет', description: 'Небольшое путешествие. Большой вечер.' },
  { title: 'За орбитой', description: 'Новая планета. Новый повод задержаться.' },
  { title: 'Тихая гавань', description: 'Медленный ритм. Время для себя.' },
]);

export function createDemoPicker(random = Math.random) {
  let last = 0;
  let remaining = [1, 2];
  return () => {
    if (!remaining.length) remaining = [0, 1, 2];
    const candidates = remaining.filter(index => index !== last);
    const index = candidates[Math.floor(random() * candidates.length)];
    remaining.splice(remaining.indexOf(index), 1);
    last = index;
    return { ...demoGames[index], number: index + 1 };
  };
}

if (typeof document !== 'undefined') {
  const pick = createDemoPicker();
  const button = document.getElementById('demo-draw');
  button.disabled = false;
  button.addEventListener('click', () => {
    const game = pick();
    document.getElementById('demo-title').textContent = game.title;
    document.getElementById('demo-description').textContent = game.description;
    document.getElementById('demo-number').textContent = `0${game.number} / 03`;
  });
  if (['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname)) {
    document.getElementById('preview-note').hidden = false;
  }
}

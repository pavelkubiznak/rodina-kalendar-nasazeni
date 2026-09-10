// Když se obsah nevejde na plakát, vynechá nejdřív to nejméně naléhavé:
// nejvzdálenější položky „Blíží se", pak cesty od té nejvzdálenější. Dnešek a další dny se nekrátí.
// Měří se ve skutečném Chromiu, takže to sedí i na fonty v CI, které se liší od Macu.
const LIMIT = 2160 - 130;   // výška plakátu minus spodní padding body v template.mjs

export function vejitSe(page) {
  return page.evaluate(limit => {
    const vynechano = [];
    // sloupce se v .main natahují na výšku toho delšího, proto se měří obsah, ne sloupec
    const pravy = () => document.querySelector('.side').lastElementChild.getBoundingClientRect().bottom;
    const levy = () => document.querySelector('.today .events').getBoundingClientRect().bottom
      + (document.querySelector('.today .trips')?.offsetHeight ?? 0);
    const odeberPosledni = (sel, blok) => {
      const el = [...document.querySelectorAll(sel)].at(-1);
      if (!el) return false;
      vynechano.push(el.innerText.replace(/\s+/g, ' ').trim());
      el.remove();
      const b = document.querySelector(blok);
      if (b && !b.querySelector(sel)) b.remove();
      return true;
    };
    while (pravy() > limit && odeberPosledni('.soon .sitem', '.soon'));
    while (levy() > limit && odeberPosledni('.trips .trip', '.trips'));
    return { vynechano, levy: Math.round(levy()), pravy: Math.round(pravy()), limit };
  }, LIMIT);
}

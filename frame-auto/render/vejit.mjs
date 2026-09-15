// Když se obsah nevejde na plakát, nejdřív zhustí rozestupy (třída .compact) a pak vynechá to nejméně naléhavé:
// nejvzdálenější položky „Blíží se", pak nejvzdálenější „Další dny" (tři zůstanou), pak cesty
// od té nejvzdálenější. Dnešek se nekrátí.
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
    // nejdřív zkusit těsnější rozestupy (stejné písmo), teprve pak něco vynechávat
    if (pravy() > limit || levy() > limit) {
      document.body.classList.add('compact');
      vynechano.push('(těsnější rozestupy)');
    }
    while (pravy() > limit && odeberPosledni('.soon .sitem', '.soon'));
    // když nestačí ani to, ubírá se od konce z „Další dny" - tři nejbližší dny zůstanou vždy
    while (pravy() > limit && document.querySelectorAll('.side .row').length > 3 && odeberPosledni('.side .row', '.side'));
    // cesty na jeden řádek dřív, než by se některá vynechala
    if (levy() > limit && document.querySelector('.trips')) {
      document.querySelector('.trips').classList.add('inline');
      vynechano.push('(cesty na řádek)');
    }
    while (levy() > limit && odeberPosledni('.trips .trip', '.trips'));
    return { vynechano, levy: Math.round(levy()), pravy: Math.round(pravy()), limit };
  }, LIMIT);
}

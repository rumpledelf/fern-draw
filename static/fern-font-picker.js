/* Reusable native font picker. No editor state or font-set management UI. */
class FernFontPicker {
  constructor(select) {
    this.select = select;
    this.select.disabled = true;
    this.select.replaceChildren(new Option("Loading fonts…", ""));
  }

  async loadDefaults() {
    const response = await fetch("/fonts/default/", { credentials: "same-origin" });
    if (!response.ok) throw new Error("Could not load default fonts");
    const { fonts } = await response.json();
    if (!Array.isArray(fonts) || !fonts.length) throw new Error("No default fonts");
    this.setFonts(fonts);
  }

  setFonts(fonts) {
    this.select.replaceChildren(...[...fonts].sort((a, b) => a.family_name.localeCompare(b.family_name)).map(font => {
      const family = `${JSON.stringify(font.css_family)}, ${font.fallback}`;
      const option = new Option(font.family_name, family);
      option.style.fontFamily = family;
      if (font.google_fonts_url) {
        const url = new URL(font.google_fonts_url);
        if (url.origin === "https://fonts.googleapis.com" && !Array.from(document.querySelectorAll("link[rel=stylesheet]")).some(link => link.href === url.href)) {
          const link = document.createElement("link");
          link.rel = "stylesheet";
          link.href = url.href;
          document.head.append(link);
        }
      }
      return option;
    }));
    this.select.disabled = false;
  }

  get value() { return this.select.disabled ? "" : this.select.value; }
  set value(family) {
    const normalize = value => value.replace(/["']/g, "").split(",")[0].trim().toLowerCase();
    const option = Array.from(this.select.options).find(item => normalize(item.value) === normalize(family));
    if (option) this.select.value = option.value;
  }
}

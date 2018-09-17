const fs = require('fs');
const yaml = require('js-yaml');
const PDFDocument = require('pdfkit');

const rawData = yaml.safeLoad(fs.readFileSync('./cv.yml', 'utf8'));
let pii;
try {
  pii = yaml.safeLoad(fs.readFileSync('./pii.yml', 'utf8'));
} catch (err) {
  console.log('Failed to load pii.yml; run `vendor/git-cipher decrypt`');
  pii = {
    street: '123 Main Street',
    zip: 12345,
    city: 'Madrid',
    country: {
      en: 'Spain',
      es: 'España',
    },
    phone: '555-555-5555',
  };
}

function localize(object, language) {
  if (typeof object === 'object' && object !== null) {
    if (rawData.languages.every(l => typeof object[l] === 'string')) {
      // Materialize the concrete language choice from the list.
      return object[language];
    }
    if (Array.isArray(object)) {
      return object.map(item => localize(item, language));
    } else {
      const nested = {};
      Object.keys(object).forEach(key => {
        nested[key] = localize(object[key], language);
      });
      return nested;
    }
  }
  return object;
}

class HTML {
  constructor(language) {
    this.info = {};
    this._content = '';
    this._language = language;
  }

  _escape(html) {
    return html
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  header(name, content, email) {
    const fonts = {
      quattrocentro:
        'https://fonts.googleapis.com/css?family=Quattrocento&subset=latin-ext',
      playfair:
        'https://fonts.googleapis.com/css?family=Playfair+Display:400,700&subset=latin-ext',
    };
    this._content +=
      `
      <!DOCTYPE html>
      <html lang="${this._language}">
      <head>
      <meta charset="utf-8">
      <title>
        ${this._escape(`${this.info.Author} — ${this.info.Title}`)}
      </title>
      <style>
        @import url('${fonts.quattrocentro}');
        @import url('${fonts.playfair}');
        body {
          font-family: 'Quattrocento', serif;
          padding: 0 5em 0 5em;
        }
        h1, h2 {
          font-family: 'Playfair Display', serif;
          font-size: 1em;
          margin-bottom: 0;
        }
        header {
          text-align: right;
        }
        p {
          margin: .5em 0 .5em 0;
        }
      </style>
      <body>
      <header>
      <h1>${this._escape(name)}</h1>
      ${content.map(line => `<p>${this._escape(line)}</p>\n`).join('\n')}
      <p><a href="mailto:${this._escape(email)}">${this._escape(email)}</a>
    `.replace(/^\s+/gm, '') + '</header>\n';
  }

  heading(text, options = {}) {
    this._content += `<h1>${this._escape(text.toUpperCase())}</h1>\n`;
  }

  subHeading(text) {
    this._content += `<h2>${this._escape(text)}</h2>\n`;
  }

  para(text) {
    this._content += `<p>${this._escape(text)}</p>\n`;
  }

  write(outfile) {
    fs.writeFileSync(`${outfile}.html`, this._content.trim() + '\n');
  }
}

class Markdown {
  constructor() {
    this.info = {};
    this._content = '';
  }

  _escape(string) {
    // gh-pages mangles UTF-8 in Markdown files.
    return string.replace(
      /[\u00a0-\u9999<>\&]/gim,
      c => '&#' + c.charCodeAt(0) + ';',
    );
  }

  header(name, content, email) {
    this._content +=
      `
      **${this._escape(name)}**
      ${content.map(line => this._escape(line)).join('\n')}
      [${this._escape(email)}](mailto:${this._escape(email)})
    `.replace(/^\s+/gm, '') + '\n';
  }

  heading(text, options = {}) {
    this._content += `## ${this._escape(text)}\n\n`;
  }

  subHeading(text) {
    this._content += `### ${this._escape(text)}\n\n`;
  }

  para(text) {
    this._content += `${this._escape(text)}\n\n`;
  }

  write(outfile) {
    fs.writeFileSync(`${outfile}.md`, this._content.trim() + '\n');
  }
}

class PDF {
  constructor() {
    this.doc = new PDFDocument();
    this.doc
      .registerFont(
        'baskerville',
        'fonts/Quattrocento/Quattrocento-Regular.ttf',
      )
      .registerFont('didot', 'fonts/Playfair_Display/PlayfairDisplay-Bold.ttf')
      .registerFont(
        'didot-regular',
        'fonts/Playfair_Display/PlayfairDisplay-Regular.ttf',
      );
    this.info = this.doc.info;
  }

  header(name, content, email) {
    let header = this.doc
      .font('didot-regular')
      .fontSize(16)
      .text(name, {align: 'right'})
      .font('baskerville')
      .fontSize(12)
      .lineGap(2)
      .moveDown();

    content.forEach(line => {
      header = header.text(line, {align: 'right'});
    });
    header = header.text(email, {
      align: 'right',
      link: `mailto:${email}`,
    });
  }

  heading(text, options = {}) {
    this.doc
      .font('didot')
      .fontSize(11)
      .moveDown()
      .text(text.toUpperCase(), {characterSpacing: 2});
    if (options.collapse) {
      // HACK alert!
      this.doc.moveUp();
    }
  }

  subHeading(text) {
    this.doc
      .font('didot')
      .fontSize(11)
      .moveDown()
      .text(text, {characterSpacing: 0.5});
  }

  para(text) {
    this.doc
      .font('baskerville')
      .fontSize(12)
      .lineGap(2)
      .text(text);
  }

  write(outfile) {
    this.doc.pipe(fs.createWriteStream(`${outfile}.pdf`));
    this.doc.end();
  }
}

class Plaintext {
  constructor() {
    this.info = {};
    this._content = '';
  }

  header(name, content, email) {
    this._content +=
      `
      ${name}
      ${content.join('\n')}
      ${email}
    `.replace(/^\s+/gm, '') + '\n';
  }

  _underline(text, underline) {
    this._content += `${text}\n`;
    this._content += underline.repeat(text.length) + '\n\n';
  }

  heading(text, options = {}) {
    this._underline(text, '=');
  }

  subHeading(text) {
    this._underline(text, '-');
  }

  _wrap(string) {
    const limit = 72;
    let width = 0;
    return string.split(' ').reduce((acc, word) => {
      if (width + word.length + 1 > limit) {
        width = word.length;
        return acc + '\n' + word;
      } else if (acc === '') {
        width = word.length;
        return word;
      } else {
        width += word.length + 1;
        return acc + ' ' + word;
      }
    }, '');
  }

  para(text) {
    this._content += `${this._wrap(text)}\n\n`;
  }

  write(outfile) {
    fs.writeFileSync(`${outfile}.txt`, this._content.trim() + '\n');
  }
}

function date(dateString) {
  // We only want to show the year.
  return dateString.toString().replace(/^(\d{4}).*/, '$1');
}

function build({doc, language, private} = {}) {
  const data = localize(
    {
      ...rawData,
      pii,
    },
    language,
  );
  doc.info.Title = 'Curriculum Vitae';
  doc.info.Author = data.identity.name;

  doc.header(
    data.identity.name,
    [
      ...(private
        ? [
            data.pii.street,
            `${data.pii.zip} ${data.pii.city}, ${data.pii.country}`,
            data.pii.phone,
          ]
        : []),
    ],
    data.identity.email,
  );

  doc.heading(data.profile.label);
  doc.para(data.profile.text);

  const ENDASH = '\u2013';
  const EMDASH = '\u2014';

  doc.heading(data.experience.label, {collapse: true});
  data.experience.jobs.forEach(
    ({role, company, location, from, to, description}) => {
      doc.subHeading(
        `${role}, ${company}; ${location} ${EMDASH} ${date(
          from,
        )}${ENDASH}${date(to)}`,
      );
      doc.para(description);
    },
  );

  doc.heading(data.education.label);
  data.education.qualifications.forEach(
    ({institution, graduated, qualification}) => {
      doc.para(`${institution}, ${date(graduated)} ${EMDASH} ${qualification}`);
    },
  );

  doc.heading(data.skills.label);
  Object.values(data.skills.categories).forEach(category => {
    doc.para(category.label + ': ' + category.items.join(', ') + '.');
  });

  const outfile = `${private ? 'private' : 'public'}/cv.${language}`;
  doc.write(outfile);
}

function mkdir(string) {
  try {
    fs.mkdirSync(string);
  } catch {
    // Let's optimistically assume error was because directory already exists.
  }
}

mkdir('public');
mkdir('private');
rawData.languages.forEach(language => {
  build({doc: new PDF(), language});
  build({doc: new PDF(), language, private: true});

  build({doc: new Markdown(), language});
  build({doc: new Markdown(), language, private: true});

  build({doc: new Plaintext(), language});
  build({doc: new Plaintext(), language, private: true});

  build({doc: new HTML(language), language});
  build({doc: new HTML(language), language, private: true});
});

const Ajv = require('ajv');
const fs = require('fs');
const yaml = require('js-yaml');
const PDFDocument = require('pdfkit');

const schema = require('./schema.json');

function validate(data, schema) {
  const ajv = new Ajv({allErrors: true, $data: true});
  const validate = ajv.compile(schema);
  const valid = validate(data);
  if (!valid) {
    console.log(validate.errors);
    console.log('Input YAML does not conform to the schema');
    process.exit(1);
  }
}

const rawData = yaml.safeLoad(fs.readFileSync('./cv.yml', 'utf8'));
validate(rawData, schema.cv);

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

validate(
  {
    ...pii,
    languages: rawData.languages,
  },
  schema.pii,
);

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

function stripProtocol(url) {
  return url.replace(/^(?:[a-z]+:)?\/\//, '');
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

  header(name, content, email, presence) {
    const fonts = {
      quattrocentro:
        'https://fonts.googleapis.com/css?family=Quattrocento&subset=latin-ext',
      playfair:
        'https://fonts.googleapis.com/css?family=Playfair+Display:400,700&subset=latin-ext',
    };

    const links = ['github', 'twitter', 'website']
      .map(site => {
        const url = presence[site];
        if (url) {
          return (
            `<p><a href="${this._escape(url)}">${this._escape(stripProtocol(url))}</a></p>`
          );
        }
      })
      .filter(Boolean)
      .join('\n');

    this._content +=
      `
      <!DOCTYPE html>
      <html lang="${this._language}">
      <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <link href="favicon.ico" rel="shortcut icon" type="image/x-icon">
      <title>
        ${this._escape(`${this.info.Author} — ${this.info.Title}`)}
      </title>
      <style>
        @import url('${fonts.quattrocentro}');
        @import url('${fonts.playfair}');
        body {
          font-family: 'Quattrocento', serif;
          padding: 0 1em 0 1em;
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
        @media (min-width: 400px) {
          body {
            padding: 0 2em 0 2em;
          }
        }
        @media (min-width: 480px) {
          body {
            padding: 0 5em 0 5em;
          }
        }

      </style>
      </head>
      <body>
      <header>
      <h1>${this._escape(name)}</h1>
      ${content.map(line => `<p>${this._escape(line)}</p>\n`).join('\n')}
      <p><a href="mailto:${this._escape(email)}">${this._escape(email)}</a>
      ${links}
    `.trim().replace(/^\s+/gm, '') + '\n</header>\n';
  }

  heading(text, options = {}) {
    this._content += `<h1>${this._escape(text.toUpperCase())}</h1>\n`;
  }

  subHeading(text) {
    this._content += `<h2>${this._escape(text)}</h2>\n`;
  }

  link(text, target) {
    this._content +=
      `<p><a href="${this._escape(target)}">${this._escape(text)}</a></p>\n`;
  }

  para(text, _options) {
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

  header(name, content, email, presence) {
    const links = ['github', 'twitter', 'website']
      .map(site => {
        const url = presence[site];
        if (url) {
          return (
            `[${this._escape(stripProtocol(url))}](${this._escape(url)})`
          );
        }
      })
      .filter(Boolean)
      .join('\n');

    this._content +=
      `
      **${this._escape(name)}**
      ${content.map(line => this._escape(line)).join('\n')}
      [${this._escape(email)}](mailto:${this._escape(email)})
      ${links}
    `.trim().replace(/^\s+/gm, '') + '\n\n';
  }

  heading(text, options = {}) {
    this._content += `## ${this._escape(text)}\n\n`;
  }

  subHeading(text) {
    this._content += `### ${this._escape(text)}\n\n`;
  }

  link(text, target) {
    this._content += `[${this._escape(text)}](${this._escape(target)})\n\n`;
  }

  para(text, _options) {
    this._content += `${this._escape(text)}\n\n`;
  }

  write(outfile) {
    fs.writeFileSync(`${outfile}.md`, this._content.trim() + '\n');
  }
}

class PDF {
  constructor() {
    this.info = {};
    this._reset();
  }

  _record(command, args = []) {
    this._commands.push({
      command,
      args,
      y: this._doc.y,
    });
  }

  _reset() {
    this._commands = [];
    this._doc = new PDFDocument();
    this._doc
      .registerFont(
        'baskerville',
        'fonts/Quattrocento/Quattrocento-Regular.ttf',
      )
      .registerFont('didot', 'fonts/Playfair_Display/PlayfairDisplay-Bold.ttf')
      .registerFont(
        'didot-regular',
        'fonts/Playfair_Display/PlayfairDisplay-Regular.ttf',
      );
  }

  _rewind() {
    const commands = [...this._commands];

    // Scan backwards looking for last heading or subheading and insert a
    // page break before it.
    for (let i = commands.length - 1; i; i--) {
      const command = commands[i].command;
      if (command === 'heading' || command === 'subHeading') {
        if (i > 0) {
          if (commands[i - 1].command !== 'pageBreak') {
            this._reset();
            commands.forEach(({command, args}, j) => {
              if (j === i) {
                this.pageBreak();
              }
              this[command].apply(this, args);
            });
            return;
          } else {
            // We already tried inserting a break and still wound up in
            // `_reset()`, so give up; the "unwanted" page break is
            // probably fine.
            return;
          }
        }
      }
    }
  }

  pageBreak() {
    this._record('pageBreak');
    this._doc.addPage();
  }

  header(name, content, email, presence) {
    this._record('header', arguments);
    let header = this._doc
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

    if (presence.github) {
      header = header.text(stripProtocol(presence.github), {
        align: 'right',
        link: presence.github,
      });
    }

    if (presence.twitter) {
      header = header.text(stripProtocol(presence.twitter), {
        align: 'right',
        link: presence.twitter,
      });
    }

    if (presence.website) {
      header = header.text(stripProtocol(presence.website), {
        align: 'right',
        link: presence.website,
      });
    }
  }

  heading(text, options = {}) {
    this._record('heading', arguments);
    this._doc
      .font('didot')
      .fontSize(11)
      .moveDown()
      .text(text.toUpperCase(), {characterSpacing: 2});
  }

  subHeading(text) {
    if (
      this._commands.length &&
      this._commands[this._commands.length - 1].command === 'heading'
    ) {
      this._doc.moveUp();
    }
    this._record('subHeading', arguments);
    this._doc
      .font('didot')
      .fontSize(11)
      .moveDown()
      .text(text, {characterSpacing: 0.5});
  }

  link(text, target) {
    this.para(text, {link: target});
  }

  para(text, options = {}) {
    const last = this._commands.length
      ? this._commands[this._commands.length - 1].y
      : this._doc.y;
    this._record('para', arguments);
    this._doc
      .font('baskerville')
      .fontSize(12)
      .lineGap(2)
      .text(text, options);
    if (this._doc.y < last) {
      // This para bumped us onto a new page; let's try again, forcing a page
      // break before a heading instead.
      this._rewind();
    }
  }

  write(outfile) {
    Object.entries(this.info).forEach(([key, value]) => {
      this._doc.info[key] = value;
    });
    this._doc.pipe(fs.createWriteStream(`${outfile}.pdf`));
    this._doc.end();
  }
}

class Plaintext {
  constructor() {
    this.info = {};
    this._content = '';
  }

  header(name, content, email, presence) {
    const urls = ['github', 'twitter', 'website']
      .map(site => (
        presence[site] ? stripProtocol(presence[site]) : null
      ))
      .filter(Boolean)
      .join('\n');
    this._content +=
      `
      ${name}
      ${content.join('\n')}
      ${email}
      ${urls}
    `.trim().replace(/^\s+/gm, '') + '\n\n';
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

  link(text, target) {
    this._content += `${this._wrap(text)}\n${target}\n\n`;
  }

  para(text, _options) {
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

function printProgress() {
  process.stdout.write('.');
}

function printDone() {
  process.stdout.write('\n');
}

function build({doc, full, language, private} = {}) {
  const data = localize(
    {
      ...rawData,
      pii,
    },
    language,
  );
  doc.info.Title = 'Curriculum Vitae';
  doc.info.Author = data.identity.name;
  doc.info.CreationDate = new Date(Date.parse('2018-09-15'));
  doc.info.ModDate = new Date(Date.parse(data.version));

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
    data.presence,
  );

  doc.heading(data.profile.label);
  doc.para(data.profile.text);

  const ENDASH = '\u2013';
  const EMDASH = '\u2014';

  if (data.experience.jobs.length) {
    doc.heading(data.experience.label);
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
  }

  if (data.education.qualifications.length) {
    doc.heading(data.education.label);
    data.education.qualifications.forEach(
      ({institution, graduated, qualification}) => {
        doc.para(`${institution}, ${date(graduated)} ${EMDASH} ${qualification}`);
      },
    );
  }

  if (full) {
    if (data.awards.items.length) {
      doc.heading(data.awards.label);
      data.awards.items.forEach(item => {
        doc.para(item);
      });
    }

    if (data.publications.items.length) {
      doc.heading(data.publications.label);
      data.publications.items.forEach(({title, link, when}) => {
        doc.link(
          `${title} ${EMDASH} ${date(when)}`,
          link
        );
      });
    }
  }

  if (data.skills.categories.length) {
    doc.heading(data.skills.label);
    Object.values(data.skills.categories).forEach(category => {
      doc.para(category.label + ': ' + category.items.join(', ') + '.');
    });
  }

  const outfile =
    (private ? 'private' : 'public') +
    '/cv' +
    (full ? '-full' : '') +
    `.${language}`;
  doc.write(outfile);

  printProgress();
}

function mkdir(string) {
  try {
    fs.mkdirSync(string);
  } catch {
    // Let's optimistically assume error was because directory already exists.
  }
}

/*
 * <ghastly-monkey-patching>
 *
 * We're doing this for a good cause, really (to produce stable output when the
 * input hasn't changed). See: https://github.com/foliojs/pdfkit/issues/868
 *
 * Random number generation based on: https://stackoverflow.com/a/19301306/2103996
 */

let m_w = 0xdeadbeef;
let m_z = 987654321;
let mask = 0xffffffff;

function seed(i) {
  m_w = i;
  m_z = 987654321;
}

function random() {
  m_z = (36969 * (m_z & 65535) + (m_z >> 16)) & mask;
  m_w = (18000 * (m_w & 65535) + (m_w >> 16)) & mask;
  let result = ((m_z << 16) + m_w) & mask;
  result /= 4294967296;
  return result + 0.5;
}

Math.random = random;

/*
 * </ghastly-monkey-patching>
 */

mkdir('public');
mkdir('private');
rawData.languages.forEach(language => {
  build({doc: new PDF(), language});
  build({doc: new PDF(), language, full: true});
  build({doc: new PDF(), language, private: true});
  build({doc: new PDF(), language, full: true, private: true});

  build({doc: new Markdown(), language});
  build({doc: new Markdown(), language, full: true});
  build({doc: new Markdown(), language, private: true});
  build({doc: new Markdown(), language, full: true, private: true});

  build({doc: new Plaintext(), language});
  build({doc: new Plaintext(), language, full: true});
  build({doc: new Plaintext(), language, private: true});
  build({doc: new Plaintext(), language, full: true, private: true});

  build({doc: new HTML(language), language});
  build({doc: new HTML(language), language, full: true});
  build({doc: new HTML(language), language, private: true});
  build({doc: new HTML(language), language, full: true, private: true});

  // Add default index page.
  fs.copyFileSync('public/cv.en.html', 'public/index.html');
  printProgress();
});
printDone();

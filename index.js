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
    this._content = `
      ${name}
      ${content.join('\n')}
      ${email}
    `.replace(/^\s+/gm, '') + '\n';
  }

  _heading(text, underline) {
    this._content += `${text}\n`;
    this._content += underline.repeat(text.length) + '\n\n';
  }

  heading(text, options = {}) {
    this._heading(text, '=');
  }

  subHeading(text) {
    this._heading(text, '-');
  }

  para(text) {
    // TODO: wrap
    this._content += `${text}\n\n`;
  }

  write(outfile) {
    fs.writeFileSync(`${outfile}.txt`, this._content.trim() + '\n');
  }
}

class Markdown {
  constructor() {
    this.info = {};
    this._content = '';
  }

  header(name, content, email) {
    this._content = `
      **${name}**
      ${content.join('\n')}
      [${email}](mailto:${email})
    `.replace(/^\s+/gm, '') + '\n';
  }

  heading(text, options = {}) {
    this._content += `## ${text}\n\n`;
  }

  subHeading(text) {
    this._content += `### ${text}\n\n`;
  }

  para(text) {
    this._content += `${text}\n\n`;
  }

  write(outfile) {
    fs.writeFileSync(`${outfile}.md`, this._content.trim() + '\n');
  }
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

  const date = dateString => {
    // We only want to show the year.
    return dateString.toString().replace(/^(\d{4}).*/, '$1');
  };

  const capitalize = string => {
    return string.slice(0, 1).toUpperCase() + string.slice(1);
  };

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
    doc.para(
      capitalize(category.label) + ': ' + category.items.join(', ') + '.',
    );
  });

  const outfile = private
    ? `private/cv.${language}`
    : `public/cv.${language}`;
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
});

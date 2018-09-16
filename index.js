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

function build({language, private} = {}) {
  const data = localize(
    {
      ...rawData,
      pii,
    },
    language,
  );
  const doc = new PDFDocument();
  doc.info.Title = 'Curriculum Vitae';
  doc.info.Author = data.identity.name;

  doc
    .registerFont('baskerville', 'fonts/Quattrocento/Quattrocento-Regular.ttf')
    .registerFont('didot', 'fonts/Playfair_Display/PlayfairDisplay-Bold.ttf')
    .registerFont(
      'didot-regular',
      'fonts/Playfair_Display/PlayfairDisplay-Regular.ttf',
    );

  const date = dateString => {
    // We only want to show the year.
    return dateString.toString().replace(/^(\d{4}).*/, '$1');
  };

  const capitalize = string => {
    return string.slice(0, 1).toUpperCase() + string.slice(1);
  };

  const heading = text =>
    doc
      .font('didot')
      .fontSize(11)
      .moveDown()
      .text(text.toUpperCase(), {characterSpacing: 2});

  const subHeading = text =>
    doc
      .font('didot')
      .fontSize(11)
      .moveDown()
      .text(text, {characterSpacing: 0.5});

  const para = text =>
    doc
      .font('baskerville')
      .fontSize(12)
      .lineGap(2)
      .text(text);

  let header = doc
    .font('didot-regular')
    .fontSize(16)
    .text(data.identity.name, {align: 'right'})
    .font('baskerville')
    .fontSize(12)
    .lineGap(2)
    .moveDown();

  if (private) {
    header = header
      .text(data.pii.street, {align: 'right'})
      .text(`${data.pii.zip} ${data.pii.city}, ${data.pii.country}`, {
        align: 'right',
      })
      .text(data.pii.phone, {align: 'right'});
  }
  header.text(data.identity.email, {
    align: 'right',
    link: `mailto:${data.identity.email}`,
  });

  heading(data.profile.label);
  para(data.profile.text);

  const ENDASH = '\u2013';
  const EMDASH = '\u2014';

  heading(data.experience.label).moveUp();
  data.experience.jobs.forEach(
    ({role, company, location, from, to, description}) => {
      subHeading(
        // TODO: use fancy proxy shit to automate language access
        // basically, implement toString on anything that has en/es subprops
        `${role}, ${company}; ${location} ${EMDASH} ${date(
          from,
        )}${ENDASH}${date(to)}`,
      );
      para(description);
    },
  );

  heading(data.education.label);
  data.education.qualifications.forEach(
    ({institution, graduated, qualification}) => {
      para(`${institution}, ${date(graduated)} ${EMDASH} ${qualification}`);
    },
  );

  heading(data.skills.label);
  Object.values(data.skills.categories).forEach(category => {
    para(capitalize(category.label) + ': ' + category.items.join(', ') + '.');
  });

  const outfile = private
    ? `private/cv.${language}.pdf`
    : `public/cv.${language}.pdf`;
  doc.pipe(fs.createWriteStream(outfile));
  doc.end();
}

function mkdir(string) {
  try {
    fs.mkdirSync(string);
  } catch {
    // Let's optimistically assume directory already exists.
  }
}

mkdir('public');
mkdir('private');
rawData.languages.forEach(language => {
  build({language});
  build({language, private: true});
});

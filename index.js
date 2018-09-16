const fs = require('fs');
const yaml = require('js-yaml');
const PDFDocument = require('pdfkit');

const data = yaml.safeLoad(fs.readFileSync('./cv.yml', 'utf8'));
let pii;
try {
  pii = yaml.safeLoad(fs.readFileSync('./pii.yml', 'utf8'));
} catch (err) {
  console.log('Failed to load pii.yml; run `vendor/git-cipher decrypt`');
  pii = {
    street: '123 Main Street',
    zip: 12345,
    city: 'Madrid',
    country: 'Spain',
    phone: '555-555-5555',
  };
}

function build(options = {}) {
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

  if (options.private) {
    header = header
      .text(pii.street, {align: 'right'})
      .text(`${pii.zip} ${pii.city}, ${pii.country}`, {align: 'right'})
      .text(pii.phone, {align: 'right'});
  }
  header.text(data.identity.email, {align: 'right'});

  heading('Profile');
  para(data.profile);

  const ENDASH = '\u2013';
  const EMDASH = '\u2014';

  heading('Experience');
  data.experience.forEach(({role, company, location, from, to, description}) => {
    subHeading(
      `${role}, ${company}; ${location} ${EMDASH} ${date(from)}${ENDASH}${date(
        to,
      )}`,
    );
    para(description);
  });

  heading('Education');
  data.education.forEach(({institution, graduated, qualification}) => {
    para(`${institution}, ${date(graduated)} ${EMDASH} ${qualification}`);
  });

  heading('Skills');
  Object.keys(data.skills).forEach(skill => {
    para(capitalize(skill) + ': ' + data.skills[skill].join(', ') + '.');
  });

  const outfile = options.private ? 'private/cv.pdf' : 'public/cv.pdf';
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
build();
build({private: true});

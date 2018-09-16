const fs = require('fs');
const yaml = require('js-yaml');
const PDFDocument = require('pdfkit');

const data = yaml.safeLoad(fs.readFileSync('./cv.yml', 'utf8'));

const doc = new PDFDocument();
doc.info.Title = 'Curriculum Vitae';
doc.info.Author = data.identity.name;

doc
  .registerFont(
    'baskerville',
    'fonts/Libre_Baskerville/LibreBaskerville-Regular.ttf',
  )
  .registerFont('didot', 'fonts/Abril_Fatface/AbrilFatface-Regular.ttf')
  .font('didot')
  .text(data.identity.name, {align: 'right'})
  .font('baskerville')
  .fontSize(8)
  .moveDown()
  .text('123 Main Street', {align: 'right'});

doc.pipe(fs.createWriteStream('cv.pdf'));
doc.end();

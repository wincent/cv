const fs = require('fs');
const yaml = require('js-yaml');
const PDFDocument = require('pdfkit');

const data = yaml.safeLoad(fs.readFileSync('./cv.yml', 'utf8'));

const doc = new PDFDocument();
doc.info.Title = 'Curriculum Vitae';
doc.info.Author = data.identity.name;
doc.text(data.identity.name, {align: 'center'});

doc.pipe(fs.createWriteStream('cv.pdf'));
doc.end();

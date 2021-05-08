import { exif, geo } from './util/exif.mjs';
import { run } from './util/run.mjs';
import path from 'path';
import { promises as fs, createReadStream } from 'fs';
import yaml from 'js-yaml';
import contentfulManagement from 'contentful-management';
import Bottleneck from 'bottleneck';

const limiter = new Bottleneck({
  minTime: 1000 / 5,
  maxConcurrent: 5,
});
const cfM = contentfulManagement.createClient({
  accessToken: process.env.CONTENTFUL_MANAGEMENT_API_TOKEN,
});
const env = await limiter
  .schedule(() => cfM.getSpace(process.env.CONTENTFUL_SPACE))
  .then((space) => limiter.schedule(() => space.getEnvironments()))
  .then((res) => res.items[0]);

const importPhoto = async (photo) => {
  const e = await exif(photo);
  const checksum = (await run('sha256sum', photo)).split(' ')[0].substr(0, 8);

  const takenAt = new Date(
    e['Exif.Image.DateTime'].replace(
      /^([0-9]{4}):([0-9]{2}):([0-9]{2}) /,
      '$1-$2-$3T',
    ),
  );

  const fileName = `${takenAt
    .toISOString()
    .substr(0, 19)
    .replace(/[-:]/g, '')}-${checksum}`;

  const outFile = path.join(process.cwd(), 'data', 'photos', `${fileName}.md`);

  let contentType = 'image/jpeg';
  if (/png$/i.test(path.parse(photo).ext)) contentType = 'image/png';
  if (/gif$/i.test(path.parse(photo).ext)) contentType = 'image/gif';
  const assetDraft = await env.createAssetFromFiles({
    fields: {
      title: {
        'en-US': checksum,
      },
      file: {
        'en-US': {
          contentType,
          fileName: path.parse(photo).name,
          file: createReadStream(photo),
        },
      },
    },
  });

  const readyAsset = await limiter.schedule(() =>
    assetDraft.processForAllLocales(),
  );
  const asset = await limiter.schedule(() => readyAsset.publish());
  console.log(outFile);
  await fs.writeFile(
    outFile,
    [
      '---',
      yaml
        .dump({
          title: fileName,
          takenAt,
          license: 'CC BY-ND 4.0',
          // geo: { lat: 50.228306, lng: 8.621735 },
          // tags: ['blue', 'grass', 'sphere'],
          url: asset.fields.file['en-US'].url,
          size: asset.fields.file['en-US'].details.size,
          image: asset.fields.file['en-US'].details.image,
          exif: e,
          geo: geo(e),
        })
        .trim(),
      '---',
    ].join('\n'),
    'utf-8',
  );
};

await importPhoto(process.argv[process.argv.length - 1]);

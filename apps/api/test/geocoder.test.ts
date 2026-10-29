import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { __testables } from '../src/geocoder.js'

describe('geocoder city parsing', () => {
  it('maps Photon city features to suggestions', () => {
    const items = __testables.fromPhoton({
      features: [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [19.0402, 47.4979] },
        properties: {
          osm_type: 'R',
          osm_id: 12405,
          name: 'Budapest',
          country: 'Hungary',
          countrycode: 'HU',
          type: 'city',
          state: 'Budapest',
        },
      }],
    })
    assert.equal(items.length, 1)
    assert.equal(items[0]?.label, 'Budapest')
    assert.equal(items[0]?.subtitle, 'Hungary')
    assert.equal(items[0]?.countryCode, 'HU')
    assert.equal(items[0]?.providerPlaceId, 'R:12405')
  })

  it('maps Nominatim city results to suggestions', () => {
    const items = __testables.fromNominatim([{
      place_id: 1,
      lat: '47.5',
      lon: '19.0',
      name: 'Budapest',
      address: { city: 'Budapest', country: 'Hungary', country_code: 'hu', state: 'Budapest' },
    }])
    assert.equal(items.length, 1)
    assert.equal(items[0]?.label, 'Budapest')
    assert.equal(items[0]?.countryCode, 'HU')
    assert.equal(items[0]?.providerPlaceId, 'nominatim:1')
  })

  it('dedupes city labels case-insensitively', () => {
    const items = __testables.dedupe([
      { id: 'Budapest', label: 'Budapest' },
      { id: 'budapest', label: 'budapest' },
      { id: 'Vienna', label: 'Vienna' },
    ])
    assert.deepEqual(items.map((item) => item.label), ['Budapest', 'Vienna'])
  })
})

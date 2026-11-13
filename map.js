import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';


// Set your Mapbox access token
mapboxgl.accessToken = 'pk.eyJ1IjoieWl3MjIxIiwiYSI6ImNtd2RieWdzZDAyamsyeW9tNXhsN2hmcGUifQ.gkjsdhV5Ak9nedca_Gdgjw';

// Initialize the map
const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18,
});


const svg = d3.select('#map').select('svg');

function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}


function minutesSinceMidnight(date) {
    return date.getHours() * 60 + date.getMinutes();
}


function filterByMinute(tripsByMinute, minute) {
  if (minute === -1) {
    return tripsByMinute.flat();
  }

  const minMinute = (minute - 60 + 1440) % 1440;
  const maxMinute = (minute + 60) % 1440;

  if (minMinute > maxMinute) {
    const beforeMidnight = tripsByMinute.slice(minMinute);
    const afterMidnight = tripsByMinute.slice(0, maxMinute + 1);

    return beforeMidnight.concat(afterMidnight).flat();
  } else {
    return tripsByMinute.slice(minMinute, maxMinute + 1).flat();
  }
}



function computeStationTraffic(stations, timeFilter = -1) {
  const departures = d3.rollup(
    filterByMinute(departuresByMinute, timeFilter),
    (v) => v.length,
    (d) => d.start_station_id
  );

  const arrivals = d3.rollup(
    filterByMinute(arrivalsByMinute, timeFilter),
    (v) => v.length,
    (d) => d.end_station_id
  );

  return stations.map((station) => {
    const id = station.short_name;

    station.arrivals = arrivals.get(id) ?? 0;
    station.departures = departures.get(id) ?? 0;
    station.totalTraffic = station.arrivals + station.departures;

    return station;
  });
}



let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);


let stationFlow = d3.scaleQuantize()
  .domain([0, 1])
  .range([0, 0.5, 1]);


map.on('load', async () => {

  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });

  map.addLayer({
    id: 'bike-lanes',
    type: 'line',
    source: 'boston_route',
    paint: {
      'line-color': '#32D400',
      'line-width': 5,
      'line-opacity': 0.6,
    },
  });


  // Cambridge bike lanes
  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson',
  });

  map.addLayer({
    id: 'cambridge-bike-lanes',
    type: 'line',
    source: 'cambridge_route',
    paint: {
      'line-color': '#32D400',
      'line-width': 5,
      'line-opacity': 0.6,
    },
  });

  // Fetch Bluebikes station data
  let jsonData;

  try {
    const jsonurl = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';

    // Await JSON fetch
    jsonData = await d3.json(jsonurl);

    console.log('Loaded JSON Data:', jsonData);

  } catch (error) {
    console.error('Error loading JSON:', error);
  }


  // Access the stations array
  if (jsonData) {

    // Step 4.1: Load traffic data
 
const trips = await d3.csv(
    'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
    (trip) => {
        trip.started_at = new Date(trip.started_at);
        trip.ended_at = new Date(trip.ended_at);
        return trip;
    }
);


trips.forEach((trip) => {
  const startedMinutes = minutesSinceMidnight(trip.started_at);
  const endedMinutes = minutesSinceMidnight(trip.ended_at);

  departuresByMinute[startedMinutes].push(trip);
  arrivalsByMinute[endedMinutes].push(trip);
});



    const stations = computeStationTraffic(jsonData.data.stations);
    console.log('Loaded Trips:', trips);
    console.log('Number of Trips:', trips.length);


    console.log('Stations with Traffic:', stations);

    // Step 4.3: Scale circle radius by traffic
    const radiusScale = d3
      .scaleSqrt()
      .domain([
        0,
        d3.max(stations, (d) => d.totalTraffic)
      ])
      .range([0, 25]);

    // Create station markers
    const circles = svg
      .selectAll('circle')
      .data(stations)
      .enter()
      .append('circle')
      .attr('r', (d) => radiusScale(d.totalTraffic))
      .style('--departure-ratio', (d) =>
        stationFlow(d.totalTraffic > 0 ? d.departures / d.totalTraffic : 0.5)
     )

      .attr('stroke', 'white')
      .attr('stroke-width', 1)
      .attr('opacity', 0.8)
      .attr('cx', (d) => getCoords(d).cx)
      .attr('cy', (d) => getCoords(d).cy)
      .each(function (d) {
        d3.select(this)
        .append('title')
        .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
    });



function updateScatterPlot(timeFilter) {
  computeStationTraffic(stations, timeFilter);

  radiusScale.domain([
    0,
    d3.max(stations, (d) => d.totalTraffic) || 1
  ]);

  
circles
  .transition()
  .duration(200)
  .attr('r', (d) => radiusScale(d.totalTraffic))
  .style('--departure-ratio', (d) =>
    stationFlow(
      d.totalTraffic > 0
        ? d.departures / d.totalTraffic
        : 0.5
    )
  );


  circles.select('title')
    .text(
      (d) => `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`
    );
}



    // Update circle positions when the map moves
    function updatePositions() {
      circles
        .attr('cx', (d) => getCoords(d).cx)
        .attr('cy', (d) => getCoords(d).cy);
    }

    updatePositions();

    map.on('move', updatePositions);
    map.on('zoom', updatePositions);
    map.on('resize', updatePositions);
    map.on('moveend', updatePositions);

    // Step 5.2: Slider reactivity
const timeSlider = document.getElementById('time-slider');
const selectedTime = document.getElementById('selected-time');
const anyTimeLabel = document.getElementById('any-time');

let timeFilter = -1;

function updateTimeDisplay() {
  timeFilter = Number(timeSlider.value);

  if (timeFilter === -1) {
    selectedTime.textContent = '';
    anyTimeLabel.style.display = 'block';
  } else {
    selectedTime.textContent = formatTime(timeFilter);
    anyTimeLabel.style.display = 'none';
  }
}


timeSlider.addEventListener('input', () => {
  updateTimeDisplay();
  updateScatterPlot(timeFilter);
});
  }
});


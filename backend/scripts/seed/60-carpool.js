// Seed plugin of Module 2 (carpooling), run by `npm run seed:demo` after the core data. Replaces the demo trips
// (source SEED) and everything attached to them (requests, chat messages, ratings): ~10 upcoming trips from several
// Greater Tunis neighbourhoods (to and from the campus), pending and accepted requests with a few chat messages, past
// completed trips with ratings (Yasmine still has someone to rate) and one cancelled trip. Sends no notification.
const Trip = require('../../models/tripModel');
const TripRequest = require('../../models/tripRequestModel');
const TripMessage = require('../../models/tripMessageModel');
const TripRating = require('../../models/tripRatingModel');
const carpool = require('../../service/carpoolService');

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const SOURCE = 'SEED';

const place = (id) => {
  const found = carpool.PLACES.find((item) => item.id === id);
  if (!found) throw new Error(`Unknown carpool place ${id}`);
  return { label: found.label, lat: found.lat, lng: found.lng };
};

// Driver, route, time (days from today + campus wall-clock time), seats, price, then requests and chat.
const TRIPS = [
  {
    key: 'ahmed-ariana',
    driver: 'ahmed.karray',
    from: 'ariana',
    day: 1,
    at: '07:45',
    seats: 3,
    price: 1.5,
    notes: 'Départ devant la station de métro Ariana. Petit détour possible par la route de la Soukra.',
    requests: [
      { passenger: 'yasmine.haddad', seats: 1, status: 'ACCEPTED', message: 'Salut Ahmed, je suis près du métro !' },
      { passenger: 'omar.ferchichi', seats: 1, status: 'PENDING', message: 'Hi! Could I join? Just a small bag.' },
    ],
    chat: [
      ['ahmed.karray', 'Salut Yasmine, rendez-vous à 7h40 devant la station, voiture grise.'],
      ['yasmine.haddad', 'Parfait, merci ! Je serai là.'],
      ['ahmed.karray', 'Je t’envoie un message si je suis en retard.'],
    ],
  },
  {
    key: 'sarra-marsa',
    driver: 'sarra.mansouri',
    from: 'marsa',
    day: 1,
    at: '08:00',
    seats: 3,
    price: 3,
    preferences: { music: true, womenOnly: true },
    notes: 'Trajet entre filles de préférence. Départ place Saf-Saf.',
    requests: [{ passenger: 'mariem.jlassi', seats: 2, status: 'ACCEPTED', message: 'On est deux, avec ma cousine.' }],
  },
  {
    key: 'youssef-ennasr',
    driver: 'youssef.hammami',
    from: 'ennasr',
    day: 2,
    at: '08:15',
    seats: 4,
    price: 1,
    notes: 'Départ à côté du parc d’Ennasr 2.',
  },
  {
    key: 'nour-lac2',
    driver: 'nour.chaabane',
    from: 'lac2',
    day: 2,
    at: '07:30',
    seats: 2,
    price: 2.5,
    preferences: { music: false },
    requests: [
      { passenger: 'aziz.benamor', seats: 1, status: 'ACCEPTED' },
      { passenger: 'ines.zouari', seats: 1, status: 'ACCEPTED', message: 'Merci d’avance !' },
    ],
    chat: [
      ['nour.chaabane', 'Bonjour à tous ! Départ à 7h30 pile devant le centre commercial.'],
      ['ines.zouari', 'Super, à demain.'],
    ],
  },
  {
    key: 'hamza-bardo',
    driver: 'hamza.dridi',
    from: 'bardo',
    day: 3,
    at: '08:00',
    seats: 3,
    price: 2,
    preferences: { pets: true },
    requests: [{ passenger: 'aya.khelifi', seats: 1, status: 'PENDING', message: 'Je peux te rejoindre au musée ?' }],
  },
  {
    key: 'yasmine-menzah',
    driver: 'yasmine.haddad',
    direction: 'FROM_CAMPUS',
    to: 'menzah',
    day: 1,
    at: '17:30',
    seats: 3,
    price: 1.5,
    notes: 'Retour après le dernier cours, je dépose vers El Menzah 6.',
    requests: [
      { passenger: 'lina.bouazizi', seats: 1, status: 'ACCEPTED', message: 'Thanks Yasmine, see you after class!' },
      { passenger: 'rami.belhaj', seats: 1, status: 'PENDING', message: 'Hi, can you drop me near Menzah 5?' },
    ],
    chat: [
      ['yasmine.haddad', 'Coucou Lina, on se retrouve au parking du bloc A.'],
      ['lina.bouazizi', 'Great, see you there!'],
    ],
  },
  {
    key: 'malek-benarous',
    driver: 'malek.ayari',
    from: 'ben-arous',
    day: 4,
    at: '07:40',
    seats: 4,
    price: 3,
  },
  {
    key: 'aya-centre',
    driver: 'aya.khelifi',
    direction: 'FROM_CAMPUS',
    to: 'centre-ville',
    day: 2,
    at: '18:00',
    seats: 3,
    price: 2,
    requests: [{ passenger: 'malek.ayari', seats: 1, status: 'ACCEPTED' }],
  },
  {
    key: 'rami-raoued',
    driver: 'rami.belhaj',
    from: 'raoued',
    day: 5,
    at: '08:30',
    seats: 2,
    price: 0.5,
    notes: 'Short ride, I pass by the Raoued roundabout.',
  },
  {
    key: 'ines-soukra',
    driver: 'ines.zouari',
    from: 'soukra',
    day: 6,
    at: '07:50',
    seats: 3,
    price: 1.5,
    requests: [{ passenger: 'skander.mejri', seats: 1, status: 'PENDING' }],
  },
  {
    key: 'omar-manouba',
    driver: 'omar.ferchichi',
    from: 'manouba',
    day: 3,
    at: '08:10',
    seats: 4,
    price: 2.5,
    notes: 'Leaving from the Manouba university campus.',
  },
  // Past trips (completed with ratings, one cancelled).
  {
    key: 'past-ahmed-ariana',
    driver: 'ahmed.karray',
    from: 'ariana',
    day: -3,
    at: '07:45',
    seats: 3,
    price: 1.5,
    status: 'COMPLETED',
    requests: [
      { passenger: 'yasmine.haddad', seats: 1, status: 'ACCEPTED' },
      { passenger: 'sarra.mansouri', seats: 1, status: 'ACCEPTED' },
    ],
    chat: [['yasmine.haddad', 'Merci pour le trajet Ahmed !']],
    ratings: [
      ['yasmine.haddad', 'ahmed.karray', 5, 'Ponctuel et très sympa !'],
      ['sarra.mansouri', 'ahmed.karray', 4, 'Bonne conduite.'],
      ['ahmed.karray', 'yasmine.haddad', 5, ''],
      ['ahmed.karray', 'sarra.mansouri', 5, 'À l’heure au rendez-vous.'],
    ],
  },
  {
    key: 'past-nour-lac2',
    driver: 'nour.chaabane',
    from: 'lac2',
    day: -6,
    at: '08:00',
    seats: 2,
    price: 2.5,
    status: 'COMPLETED',
    requests: [
      { passenger: 'yasmine.haddad', seats: 1, status: 'ACCEPTED' },
      { passenger: 'aziz.benamor', seats: 1, status: 'ACCEPTED' },
    ],
    ratings: [
      ['aziz.benamor', 'nour.chaabane', 5, 'Voiture propre et bonne ambiance.'],
      ['nour.chaabane', 'aziz.benamor', 4, ''],
    ],
  },
  {
    key: 'past-yasmine-ennasr',
    driver: 'yasmine.haddad',
    direction: 'FROM_CAMPUS',
    to: 'ennasr',
    day: -2,
    at: '17:30',
    seats: 3,
    price: 1,
    status: 'COMPLETED',
    requests: [{ passenger: 'omar.ferchichi', seats: 1, status: 'ACCEPTED' }],
    ratings: [
      ['omar.ferchichi', 'yasmine.haddad', 5, 'Great ride, thanks!'],
      ['yasmine.haddad', 'omar.ferchichi', 4, ''],
    ],
  },
  {
    key: 'past-hamza-bardo',
    driver: 'hamza.dridi',
    from: 'bardo',
    day: -10,
    at: '08:00',
    seats: 3,
    price: 2,
    status: 'COMPLETED',
    requests: [{ passenger: 'aya.khelifi', seats: 1, status: 'ACCEPTED' }],
    ratings: [['aya.khelifi', 'hamza.dridi', 3, 'Un peu en retard, mais sympa.']],
  },
  {
    key: 'past-sarra-cancelled',
    driver: 'sarra.mansouri',
    from: 'marsa',
    day: -8,
    at: '08:00',
    seats: 3,
    price: 3,
    status: 'CANCELLED',
    cancelReason: 'Voiture au garage, désolée !',
    requests: [{ passenger: 'mariem.jlassi', seats: 1, status: 'ACCEPTED' }],
  },
];

const run = async (ctx) => {
  const { users, now, time, log } = ctx;
  const account = (name) => {
    const user = users.byEmail[`${name}@campuslink.local`];
    if (!user) throw new Error(`Missing demo account ${name}@campuslink.local`);
    return user;
  };
  const today = time.formatLocalDate(now);
  const at = (days, hm) => time.parseLocalDateTime(time.addDaysToDateString(today, days), hm);

  // Remove the previous demo data (and anything attached to the demo trips).
  const previous = await Trip.find({ source: SOURCE }).select('_id').lean();
  const previousIds = previous.map((trip) => trip._id);
  await Promise.all([
    TripRequest.deleteMany({ $or: [{ trip: { $in: previousIds } }, { source: SOURCE }] }),
    TripMessage.deleteMany({ $or: [{ trip: { $in: previousIds } }, { source: SOURCE }] }),
    TripRating.deleteMany({ $or: [{ trip: { $in: previousIds } }, { source: SOURCE }] }),
  ]);
  await Trip.deleteMany({ source: SOURCE });

  const site = carpool.campus();
  const counts = { trips: 0, requests: 0, messages: 0, ratings: 0 };

  for (const spec of TRIPS) {
    const driver = account(spec.driver);
    const direction = spec.direction || 'TO_CAMPUS';
    const departure = direction === 'FROM_CAMPUS' ? site : place(spec.from);
    const destination = direction === 'FROM_CAMPUS' ? place(spec.to) : site;
    const departureAt = at(spec.day, spec.at);
    const requests = spec.requests || [];
    const taken = requests.filter((r) => r.status === 'ACCEPTED').reduce((sum, r) => sum + r.seats, 0);
    const status = spec.status || (taken >= spec.seats ? 'FULL' : 'OPEN');
    const createdAt = new Date(Math.min(now.getTime(), departureAt.getTime()) - 2 * 24 * HOUR_MS);

    const trip = await Trip.create({
      driver: driver._id,
      driverSnapshot: { firstname: driver.firstname, lastname: driver.lastname },
      direction,
      departure: carpool.placeDoc(departure),
      destination: carpool.placeDoc(destination),
      searchPoint: carpool.roundedPoint(carpool.offCampusEnd(direction, departure, destination)),
      departureAt,
      seats: spec.seats,
      seatsLeft: Math.max(0, spec.seats - taken),
      pricePerSeat: spec.price,
      distanceKm: carpool.roadDistanceKm(departure, destination),
      preferences: { ...Trip.DEFAULT_PREFERENCES, ...(spec.preferences || {}) },
      notes: spec.notes || '',
      status,
      cancelledAt: status === 'CANCELLED' ? new Date(departureAt.getTime() - 12 * HOUR_MS) : null,
      cancelledBy: status === 'CANCELLED' ? 'DRIVER' : null,
      cancelReason: spec.cancelReason || null,
      completedAt: status === 'COMPLETED' ? new Date(departureAt.getTime() + HOUR_MS) : null,
      source: SOURCE,
    });
    await Trip.collection.updateOne({ _id: trip._id }, { $set: { createdAt, updatedAt: createdAt } });
    counts.trips += 1;

    for (const [index, spec2] of requests.entries()) {
      const passenger = account(spec2.passenger);
      const requestedAt = new Date(createdAt.getTime() + (index + 1) * HOUR_MS);
      const request = await TripRequest.create({
        trip: trip._id,
        passenger: passenger._id,
        passengerSnapshot: { firstname: passenger.firstname, lastname: passenger.lastname },
        seats: spec2.seats,
        message: spec2.message || '',
        status: spec2.status,
        active: ['PENDING', 'ACCEPTED'].includes(spec2.status),
        decidedAt: spec2.status === 'ACCEPTED' ? new Date(requestedAt.getTime() + 30 * MINUTE_MS) : null,
        source: SOURCE,
      });
      await TripRequest.collection.updateOne({ _id: request._id }, { $set: { createdAt: requestedAt } });
      counts.requests += 1;
    }

    // Chat: the last messages were written a little before now (or before the departure for past trips).
    const chat = spec.chat || [];
    const lastAt = Math.min(now.getTime() - 20 * MINUTE_MS, departureAt.getTime() + 2 * HOUR_MS);
    for (const [index, [author, body]] of chat.entries()) {
      const sender = account(author);
      const message = await TripMessage.create({
        trip: trip._id,
        sender: sender._id,
        senderSnapshot: { firstname: sender.firstname, lastname: sender.lastname },
        body,
        source: SOURCE,
      });
      const sentAt = new Date(lastAt - (chat.length - 1 - index) * 7 * MINUTE_MS);
      await TripMessage.collection.updateOne({ _id: message._id }, { $set: { createdAt: sentAt } });
      counts.messages += 1;
    }

    for (const [raterName, rateeName, score, comment] of spec.ratings || []) {
      const rater = account(raterName);
      const ratee = account(rateeName);
      await TripRating.create({
        trip: trip._id,
        rater: rater._id,
        ratee: ratee._id,
        raterRole: rater._id.equals(driver._id) ? 'DRIVER' : 'PASSENGER',
        rateeRole: ratee._id.equals(driver._id) ? 'DRIVER' : 'PASSENGER',
        score,
        comment,
        source: SOURCE,
      });
      counts.ratings += 1;
    }
  }

  log(
    `${counts.trips} trips (${TRIPS.filter((t) => t.day > 0).length} upcoming), ${counts.requests} requests, ` +
      `${counts.messages} chat messages, ${counts.ratings} ratings.`
  );
};

module.exports = { name: 'carpool', run };

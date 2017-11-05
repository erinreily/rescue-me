const express = require('express');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const fs = require('fs');
const Router = require('express-promise-router');
const http = require('http');
const https = require('https');

let creds = null;

try {
    creds = {
        key: fs.readFileSync('../client-key.pem'),
        cert: fs.readFileSync('../client-cert.pem')
    };
} catch (e) {}

const app = express();

const configPath = 'config.json';
const config = JSON.parse(fs.readFileSync(configPath, 'UTF-8'));
const pool = new Pool(config.database);

const jsonParser = bodyParser.json();

const port = process.env.PORT || 80;

const router = new Router();

// request: {
//     people: [{
//         name: string
//         gender: 'male' or 'female' or 'other'
//         age: number
//         comments: string
//     }]
//     pets: [{
//         type: string
//         breed: string
//         age: int
//     }]
//     contacts: [{
//         phone: string
//         email: string
//         primary: boolean
//     }]
//     severity: number
//     location: {
//         longitude: number
//         latitude: number
//     }
//     // only set after insertion:
//     id: number
//     resolved: boolean
// }

const VALID_GENDERS = ['male', 'female', 'other'];

function validateRequest(request) {
    const errors = [];
    if (!request.people || request.people.length === 0) {
        errors.push('people must not be empty');
    } else {
        for (const person of request.people) {
            if (!person.name)
                errors.push('name must not be empty');
            if (!VALID_GENDERS.includes(person.gender))
                errors.push('gender must be one of \'male\' or \'female\'');
            if (person.age < 0)
                errors.push('age must be at least 0');
            if (!person.comments)
                person.comments = '';
        }
    }
    if (request.pets) {
        for (const pet of request.pets) {
            if (!pet.type)
                errors.push('pet type must not be empty');
        }
    }
    if (!request.contacts || request.contacts.length == 0) {
        errors.push('contacts must not be empty');
    }
    let primaryFound = false;
    if (request.contacts) {
        for (const contact of request.contacts) {
            if (!contact.phone && !contact.email)
                errors.push('either phone or email must not be empty');
            if (contact.phone)
                if (!/^\d{10}$/.test(contact.phone))
                    errors.push('phone number must be a valid US phone number');
            if (contact.email)
                if (!/^[^@]+@[^@.]+\.[^@]+/.test(contact.email))
                    errors.push('email must be a valid email (exactly one @ symbol, domain must have a dot)');
            if (contact.primary === 'true')
                contact.primary = true;
            if (contact.primary === 'false')
                contact.primary = false;
            if (!(contact.primary === true || contact.primary === false))
                errors.push('primary must be a true or false');
            if (contact.primary) {
                if (primaryFound)
                    errors.push('must have exactly one primary contact');
                primaryFound = true;
            }
        }
    }
    if (!primaryFound)
        errors.push('must have exactly one primary contact');
    if (!request.severity)
        errors.push('severity must not be empty');
    if (!request.location || !request.location.longitude || !request.location.latitude)
        errors.push('location must be an object {longitude, latitude}');
    if (request.id)
        errors.push('id must not be present');
    if (request.resolved)
        errors.push('resolved must not be present');
    if (errors.length > 0)
        return {
            'valid': false,
            'errors': errors
        }
    else
        return {
            'valid': true,
            'errors': []
        }
}

async function addRequest(request) {
    const client = await pool.connect();
    try {
        const { rows } = await client.query('INSERT INTO request (severity, location) VALUES ($1, ST_MakePoint($2, $3)) RETURNING id', [request.severity, request.location.longitude, request.location.latitude]);
        if (rows.length == 0) {
            throw 'INSERT ... RETURNING returned no rows';
        }
        if (rows.length > 1) {
            throw 'INSERT ... RETURNING returned more than one row';
        }
        const id = rows[0].id;
        for (const person of request.people) {
            await client.query('INSERT INTO person (name, gender, age, comments, request_id) VALUES ($1, $2, $3, $4, $5)', [person.name, person.gender, person.age, person.comments, id]);
        }
        for (const pet of request.pets) {
            await client.query('INSERT INTO pet (type, breed, age, request_id) VALUES ($1, $2, $3, $4)', [pet.type, pet.breed || '', pet.age === 0 ? 0 : pet.age || null, id]);
        }
        for (const contact of request.contacts) {
            await client.query('INSERT INTO contact (phone, email, isprimary, request_id) VALUES ($1, $2, $3, $4)', [contact.phone || null, contact.email || null, contact.primary, id]);
        }
        return {'id': id};
    } finally {
        client.release();
    }
}

router.get('/requests', async (req, res) => {
    if (!req.query.near) {
        res.status(400).json({'status': 'error', 'errors': ['near location must not be empty'], 'data': null});
        return;
    }
    const nearLoc = req.query.near;
    const nearParts = nearLoc.split(',');
    if (nearParts.length != 2) {
        res.status(400).json({'status': 'error', 'errors': ['near location must be exactly 2 comma-separated numbers (longitude,latitude)'], 'data': null});
        return;
    }
    const longitude = parseFloat(nearParts[0]),
          latitude  = parseFloat(nearParts[1]);
    if (isNaN(longitude) || isNaN(latitude)) {
        res.status(400).json({'status': 'error', 'errors': ['near location must be exactly 2 comma-separated numbers (longitude,latitude)'], 'data': null});
        return;
    }
    if (!req.query.radius) {
        res.status(400).json({'status': 'error', 'errors': ['radius must not be empty'], 'data': null});
        return;
    }
    const radius = parseFloat(req.query.radius);
    if (isNaN(radius)) {
        res.status(400).json({'status': 'error', 'errors': ['radius must be a valid number'], 'data': null});
        return;
    }
    const minSeverity = parseFloat(req.minSeverity) || 0;
    const client = await pool.connect();
    try {
        const { rows } = await client.query('SELECT id, severity, creation, ST_X(location) as longitude, ST_Y(location) as latitude, ST_Distance_Sphere(location, ST_MakePoint($1, $2)) as distance, taken FROM request WHERE NOT resolved AND ST_Distance_Sphere(location, ST_MakePoint($1, $2)) <= $3 AND severity >= $4 ORDER BY severity DESC, creation DESC LIMIT 500', [longitude, latitude, radius, minSeverity]);
        res.json({'status': 'success', 'data': rows, 'errors': []});
    } finally {
        client.release();
    }
});

router.get('/requests/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
        res.status(400).json({'status': 'error', 'errors': ['id must be a valid integer'], 'data': null});
        return;
    }
    const client = await pool.connect();
    try {
        const { rows } = await client.query('SELECT id, severity, ST_X(location) as longitude, ST_Y(location) as latitude, creation, resolved FROM request WHERE id = $1', [id]);
        if (rows.length == 0) {
            res.status(404).json({'status': 'error', 'errors': ['request with id ' + id + ' not found'], 'data': null});
            return;
        }
        if (rows.length > 1) {
            res.status(500).json({'status': 'error', 'errors': ['SELECT on primary key returned more than one row'], 'data': null});
            return;
        }
        const row = rows[0];
        const peopleResult = await client.query('SELECT id, name, gender, age, comments FROM person WHERE request_id = $1', [id]);
        const petsResult = await client.query('SELECT id, type, breed, age FROM pet WHERE request_id = $1', [id]);
        const contactResult = await client.query('SELECT id, phone, email, isprimary AS primary FROM contact WHERE request_id = $1', [id]);
        const request = {
            id: row.id,
            severity: row.severity,
            location: { 'longitude': row.longitude, 'latitude': row.latitude },
            creation: row.creation,
            resolved: row.resolved,
            people: peopleResult.rows,
            pets: petsResult.rows,
            contact: contactResult.rows
        };
        res.json({'status': 'success', 'errors': [], 'data': request});
    } finally {
        client.release();
    }
});

router.post('/requests', jsonParser, async (req, res) => {
    if (!req.body) {
        res.status(400).json({
            'status': 'error',
            'data': null,
            'errors': ['body of request must be valid JSON']
        });
        return;
    }
    const result = validateRequest(req.body);
    if (!result.valid) {
        res.status(400).json({
            'status': 'error',
            'data': null,
            'errors': result.errors
        });
        return;
    }
    let added = null;
    let error = null;
    try {
        added = await addRequest(req.body);
    } catch (e) {
        error = e;
    }
    if (!added) {
        res.status(500).json({
            'status': 'error',
            'data': null,
            'errors': ['internal error adding the request: ' + error]
        });
        return;
    }
    res.json({
         'status': 'success',
         'data': added,
         'errors': []
    });
});

router.post('/requests/:id/resolve', jsonParser, async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
        res.status(400).json({'status': 'error', 'errors': ['id must be a valid integer'], 'data': null});
    }
    const client = await pool.connect();
    try {
        const { rows } = await client.query('SELECT resolved FROM request WHERE id = $1', [id]);
        if (rows.length > 1)
            throw [500, 'SELECT on primary key returned more than one row'];
        if (rows.length == 0)
            throw [404, 'no request with id ' + id];
        if (rows[0].resolved)
            throw [400, 'request ' + id + ' already resolved'];
        await client.query('UPDATE request SET resolved = true WHERE id = $1', [id]);
        res.json({'status': 'success', 'errors': [], 'data': null});
    } catch (e) {
        res.status(e[0]).json({'status': 'error', 'errors': [e[1]], 'data': null});
    } finally {
        client.release();
    }
});

router.post('/requests/:id/take', jsonParser, async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
        res.status(400).json({'status': 'error', 'errors': ['id must be a valid integer'], 'data': null});
    }
    const client = await pool.connect();
    try {
        const { rows } = await client.query('SELECT taken FROM request WHERE id = $1', [id]);
        if (rows.length > 1)
            throw [500, 'SELECT on primary key returned more than one row'];
        if (rows.length == 0)
            throw [404, 'no request with id ' + id];
        if (rows[0].taken !== null)
            throw [400, 'request ' + id + ' already taken'];
        await client.query('UPDATE request SET taken = NOW() WHERE id = $1', [id]);
        res.json({'status': 'success', 'errors': [], 'data': null});
    } catch (e) {
        res.status(e[0]).json({'status': 'error', 'errors': [e[1]], 'data': null});
    } finally {
        client.release();
    }
});

function requestHTTPS(url) {
    return new Promise((resolve, reject) => {
        const request = https.get(url, (response) => {
            const body = [];
            response.on('data', (chunk) => body.push(chunk));
            response.on('end', () => resolve({'status': response.statusCode, 'body': body.join('')}));
        });
        request.on('error', (err) => reject(err))
    });
}

router.get('/geocode', async (req, res) => {
    try {
        const address = req.query.address;
        if (!address)
            throw 'address must not be blank';
        const response = await requestHTTPS('https://maps.googleapis.com/maps/api/geocode/json?address=' + encodeURIComponent(address) + '&key=' + encodeURIComponent(config.googleKey));
        if (response.status != 200)
            throw response;
        const responseJSON = JSON.parse(response.body);
        if (responseJSON.status != 'OK')
            throw response;
        const loc = responseJSON.results[0].geometry.location;
        res.json({
            'status': 'success',
            'data': {
                'latitude': loc.lat,
                'longitude': loc.lng
            },
            'errors': []
        });
    } catch (err) {
        res.status(400).json({
            'status': 'error',
            'data': null,
            'errors': [err]
        });
    }
});

router.get('/geodecode', async (req, res) => {
    try {
        const latitude = parseFloat(req.query.latitude);
        const longitude = parseFloat(req.query.longitude);
        if (isNaN(latitude) || isNaN(longitude))
            throw 'latitude and longitude must be valid numbers';
        const response = await requestHTTPS('https://maps.googleapis.com/maps/api/geocode/json?latlng=' + encodeURIComponent(latitude) + ',' + encodeURIComponent(longitude) + '&key=' + encodeURIComponent(config.googleKey));
        if (response.status != 200)
            throw response;
        const responseJSON = JSON.parse(response.body);
        if (responseJSON.status != 'OK')
            throw response;
        const address = responseJSON.results[0].formatted_address;
        res.json({
            'status': 'success',
            'data': { 'address': address },
            'errors': []
        });
    } catch (err) {
        res.status(400).json({
            'status': 'error',
            'data': null,
            'errors': [err]
        });
    }
});

app.use('/api', router);

app.use(express.static('static'));

http.createServer(app).listen(port, () => {
    console.log('listening on HTTP port ' + port);
    // test query database
    // pool.connect().then(client => {
    //     return client.query('SELECT NOW();')
    //                  .then(res => {
    //                      client.release();
    //                      console.log("result: ", res.rows[0]);
    //                  })
    //                  .catch(err => {
    //                      client.release();
    //                      console.log(err.stack);
    //                  });
    // });
});

https.createServer(creds, app).listen(443, () => {
    console.log('listening on HTTPS');
});

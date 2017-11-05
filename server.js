const express = require('express');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const fs = require('fs');
const Router = require('express-promise-router');

const app = express();

const configPath = 'config.json';
const pool = new Pool(JSON.parse(fs.readFileSync(configPath, 'UTF-8')));

const jsonParser = bodyParser.json();

const port = process.env.PORT || 80;

const router = new Router();

// request: {
//     people: [{
//         name: string
//         gender: 'male' or 'female'
//         age: number
//         comments: string
//     }]
//     pets: [{
//         type: string
//         breed: string
//         age: int
//     }]
//     contact: [{
//         phone: string
//         email: string
//         primary: bool
//     }]
//     id: number
//     severity: number
// }

const VALID_GENDERS = ['male', 'female'];

function validateRequest(request) {
    const errors = [];
    if (request.people.length === 0) {
        errors.push('people must not be empty');
    }
    for (const person of request.people) {
        if (!person.name)
            errors.push('name must not be empty');
        if (!['male', 'female'].includes(person.gender))
            errors.push('gender must be one of \'male\' or \'female\'');
        if (person.age < 0)
            errors.push('age must be at least 0');
        if (!person.comments)
            person.comments = '';
    }
    for (const pet of request.pets) {
        if (!pet.type)
            errors.push('pet type must not be empty');
    }
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
    }
    if (!request.severity)
        errors.push('severity must not be empty');
    if (request.id)
        errors.push('id must not be present');
    if (errors)
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

sample_requests = [
    {
        'id': 1,
        'body': {
            'people': [
                {
                    'name': 'John Doe',
                    'gender': 'male',
                    'age': 24,
                    'comments': ''
                },
                {
                    'name': 'Jane Doe',
                    'gender': 'female',
                    'age': 25,
                    'comments': 'Both legs broken.'
                }
            ],
            'pets': [
                {
                    'type': 'dog',
                    'breed': 'labrador',
                    'age': 3
                },
                {
                    'type': 'cat',
                    'breed': 'domestic',
                    'age': 2
                }
            ],
            'contact': [
                {
                    'phone': '1234567890',
                    'email': 'johndoe@example.com',
                    'primary': true
                },
                {
                    'phone': '5551234567',
                    'email': 'janedoe@example.com',
                    'primary': false
                }
            ],
            'severity': 2,
            'confirm': 12345
        },
        'location': {
            'latitude': 29.7215787,
            'longitude': -95.3406465,
            'accuracy': 28
        }
    }
];

function addRequest(request) {
    request.id = 13579;
    return request;
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
        const { rows } = await client.query('SELECT id, severity, creation, ST_X(location) as longitude, ST_Y(location) as latitude FROM request WHERE NOT resolved AND ST_Distance_Sphere(location, ST_MakePoint($1, $2)) <= $3 AND severity >= $4 ORDER BY severity DESC, creation DESC LIMIT 500', [longitude, latitude, radius, minSeverity]);
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

router.post('/requests', jsonParser, (req, res) => {
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
        req.status(400).json({
            'status': 'error',
            'data': null,
            'errors': result.errors
        });
        return;
    }
    const added = addRequest(req.body);
    if (!added) {
        req.status(500).json({
            'status': 'error',
            'data': null,
            'errors': ['internal error adding the request']
        });
        return;
    }
    req.json({
         'status': 'success',
         'data': added,
         'errors': []
    });
});

app.use('/api', router);

app.use(express.static('static'));

app.listen(port, () => {
    console.log('listening on port ' + port);
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

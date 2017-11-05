const express = require('express');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const fs = require('fs');

const app = express();

const configPath = 'config.json';
const pool = new Pool(JSON.parse(fs.readFileSync(configPath, 'UTF-8')));

const jsonParser = bodyParser.json();

const port = process.env.PORT || 80;

const router = express.Router();

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

router.get('/requests', (req, res) => {
    res.json(sample_requests);
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

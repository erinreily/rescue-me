const express = require('express');
const app = express();
const bodyParser = require('body-parser');

app.use(bodyParser.json());

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
//         confirm: number
//         primary: bool
//     }]
//     severity: number
// }

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
                    'confirm': 12345,
                    'primary': true
                },
                {
                    'phone': '5551234567',
                    'email': 'janedoe@example.com',
                    'confirm': 54321,
                    'primary': false
                }
            ],
            'severity': 2
        },
        'location': {
            'latitude': 29.7215787,
            'longitude': -95.3406465,
            'accuracy': 28
        }
    }
];

router.get('/requests', (req, res) => {
    res.json(sample_requests);
});

app.use('/api', router);

app.use(express.static('static'));

app.listen(port);
console.log('listening on port ' + port);

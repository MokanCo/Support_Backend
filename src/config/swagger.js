import path from 'path';
import { fileURLToPath } from 'url';
import swaggerJSDoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(__dirname, '..');

const port = process.env.PORT || 5000;
const serverUrl = process.env.API_PUBLIC_URL || `http://localhost:${port}`;

const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'Mokanco Support API',
    version: '1.0.0',
    description:
      'API documentation for the support ticket system. Authenticate via **POST /api/auth/login**, then send **Authorization: Bearer &lt;token&gt;** on protected routes.',
  },
  servers: [{ url: serverUrl, description: 'API server' }],
  tags: [
    { name: 'Auth', description: 'Login, logout, and current user' },
    { name: 'Locations', description: 'Locations (organizations)' },
    { name: 'Users', description: 'User management (admin only)' },
    { name: 'Tickets', description: 'Support tickets' },
    { name: 'Ticket internal notes', description: 'Staff-only notes on tickets (admin & support)' },
    { name: 'Messages', description: 'Ticket conversation messages' },
    { name: 'System', description: 'Operational endpoints' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT returned from POST /api/auth/login',
      },
    },
    schemas: {
      ErrorMessage: {
        type: 'object',
        required: ['success', 'message'],
        properties: {
          success: { type: 'boolean', example: false },
          message: { type: 'string', example: 'Error message' },
        },
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'string', example: '507f1f77bcf86cd799439011' },
          name: { type: 'string', example: 'Jane Admin' },
          email: { type: 'string', format: 'email', example: 'admin@mokanco.example' },
          role: { type: 'string', enum: ['admin', 'support', 'partner'], example: 'admin' },
          locationId: { type: 'string', nullable: true, example: null },
          isDisabled: { type: 'boolean', example: false },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      Location: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string', example: 'Mokanco HQ' },
          email: { type: 'string', format: 'email' },
          phone: { type: 'string', example: '+1-555-0100' },
          address: { type: 'string' },
          city: { type: 'string' },
          state: { type: 'string' },
          zip: { type: 'string' },
          isDisabled: { type: 'boolean', example: false },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      Ticket: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'MongoDB _id' },
          ticketId: { type: 'string', example: 'MK-0001' },
          title: { type: 'string' },
          description: { type: 'string' },
          category: { type: 'string' },
          status: {
            type: 'string',
            enum: ['in_queue', 'in_progress', 'completed', 'cancelled'],
          },
          priority: { type: 'string', enum: ['p0', 'p1', 'p2', 'p3', 'p4'] },
          progress: { type: 'integer', minimum: 0, maximum: 100 },
          deadline: { type: 'string', format: 'date-time', nullable: true },
          overdue: { type: 'boolean', description: 'Computed from deadline' },
          locationId: { type: 'string' },
          createdBy: { type: 'string' },
          assignedTo: { type: 'string', nullable: true },
          resolution: { type: 'string', description: 'Latest resolution text when completed' },
          completedAt: { type: 'string', format: 'date-time', nullable: true },
          resolutionBy: { type: 'string', nullable: true },
          resolutionByName: { type: 'string', nullable: true },
          resolutionHistory: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                body: { type: 'string' },
                authorId: { type: 'string' },
                authorName: { type: 'string' },
                createdAt: { type: 'string', format: 'date-time' },
              },
            },
          },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      TicketInternalNote: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          ticketId: { type: 'string' },
          body: { type: 'string' },
          authorId: { type: 'string' },
          authorName: { type: 'string' },
          authorRole: { type: 'string', enum: ['admin', 'support', 'partner'] },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      Message: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          ticketId: { type: 'string' },
          senderId: { type: 'string' },
          text: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          sender: {
            type: 'object',
            nullable: true,
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              email: { type: 'string' },
              role: { type: 'string' },
            },
          },
        },
      },
      LoginRequest: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email', example: 'admin@mokanco.example' },
          password: { type: 'string', format: 'password', example: 'ChangeMe123!' },
        },
      },
      LoginResponse: {
        type: 'object',
        properties: {
          user: { $ref: '#/components/schemas/User' },
          token: {
            type: 'string',
            example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
          },
        },
      },
      MeResponse: {
        type: 'object',
        properties: {
          user: { $ref: '#/components/schemas/User' },
          location: {
            oneOf: [{ $ref: '#/components/schemas/Location' }, { type: 'null' }],
          },
        },
      },
      CreateLocationRequest: {
        type: 'object',
        required: ['name', 'email', 'phone', 'address'],
        properties: {
          name: { type: 'string' },
          email: { type: 'string', format: 'email' },
          phone: { type: 'string' },
          address: { type: 'string' },
        },
      },
      CreateUserRequest: {
        type: 'object',
        required: ['name', 'email', 'password', 'role'],
        properties: {
          name: { type: 'string' },
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 8 },
          role: { type: 'string', enum: ['admin', 'support', 'partner'] },
          locationId: { type: 'string', description: 'Required for role partner' },
        },
      },
      UpdateUserRequest: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 8 },
          role: { type: 'string', enum: ['admin', 'support', 'partner'] },
          locationId: { type: 'string', nullable: true },
          isDisabled: { type: 'boolean', description: 'Soft-disable login for this user' },
        },
      },
      CreateTicketRequest: {
        type: 'object',
        required: ['title', 'category', 'locationId'],
        properties: {
          title: { type: 'string', example: 'Printer not working' },
          description: { type: 'string', example: 'Office B, 3rd floor' },
          category: { type: 'string', example: 'Hardware' },
          status: {
            type: 'string',
            enum: ['in_queue', 'in_progress', 'completed', 'cancelled'],
          },
          priority: { type: 'string', enum: ['p0', 'p1', 'p2', 'p3', 'p4'] },
          progress: { type: 'integer', minimum: 0, maximum: 100 },
          deadline: { type: 'string', format: 'date-time' },
          locationId: { type: 'string' },
          assignedTo: { type: 'string', nullable: true },
        },
      },
      UpdateTicketRequest: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          category: { type: 'string' },
          status: {
            type: 'string',
            enum: ['in_queue', 'in_progress', 'completed', 'cancelled'],
          },
          priority: { type: 'string', enum: ['p0', 'p1', 'p2', 'p3', 'p4'] },
          progress: { type: 'integer', minimum: 0, maximum: 100 },
          deadline: { type: 'string', format: 'date-time', nullable: true },
          locationId: { type: 'string' },
          assignedTo: { type: 'string', nullable: true },
          resolution: {
            type: 'string',
            description: 'Required when setting status to completed (with progress 100%)',
            example: 'Replaced faulty switch; verified on site.',
          },
        },
      },
      BulkTicketIdsRequest: {
        type: 'object',
        required: ['ids'],
        properties: {
          ids: {
            type: 'array',
            items: { type: 'string' },
            example: ['507f1f77bcf86cd799439011'],
          },
        },
      },
      BulkUpdateTicketsRequest: {
        type: 'object',
        required: ['ids', 'updates'],
        properties: {
          ids: {
            type: 'array',
            items: { type: 'string' },
            example: ['507f1f77bcf86cd799439011'],
          },
          updates: {
            type: 'object',
            description: 'Fields to apply to each ticket (same shape as PATCH /api/tickets/{id})',
            additionalProperties: true,
          },
        },
      },
      CreateMessageRequest: {
        type: 'object',
        required: ['ticketId', 'text'],
        properties: {
          ticketId: { type: 'string' },
          text: { type: 'string', example: 'We are looking into this now.' },
        },
      },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    '/health': {
      get: {
        tags: ['System'],
        summary: 'Health check',
        description: 'Returns service availability (no authentication).',
        security: [],
        responses: {
          200: {
            description: 'Service is up',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { ok: { type: 'boolean', example: true } },
                },
              },
            },
          },
        },
      },
    },
  },
};

const options = {
  definition: swaggerDefinition,
  apis: [path.join(srcDir, 'routes', '*.js'), path.join(srcDir, 'models', '*.js')],
};

export const swaggerSpec = swaggerJSDoc(options);

/**
 * @param {import('express').Express} app
 */
export function mountSwagger(app) {
  app.use(
    '/api-docs',
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, {
      explorer: true,
      customSiteTitle: 'Mokanco Support API',
    }),
  );
  app.get('/api-docs.json', (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.json(swaggerSpec);
  });
}

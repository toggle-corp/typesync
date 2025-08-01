import { schema } from '../../../schema/index.js';
import { createPythonGenerator } from '../_impl.js';
import { PythonGeneration } from '../_types.js';

describe('PythonGeneratorImpl', () => {
  it('produces the correct generation for a flat schema', async () => {
    const generator = createPythonGenerator({
      target: 'firebase-admin@6',
    });
    const s = schema.createSchemaFromDefinition({
      Username: {
        model: 'alias',
        type: 'string',
        docs: 'A string that uniquely identifies the user.',
      },
      UserRole: {
        model: 'alias',
        type: {
          type: 'enum',
          members: [
            { label: 'Admin', value: 'admin' },
            { label: 'User', value: 'user' },
          ],
        },
      },
      Project: {
        model: 'document',
        docs: 'Represents a project within a workspace',
        type: {
          type: 'object',
          fields: {
            id: {
              type: 'string',
              docs: 'The ID of the project',
            },
            completed: {
              type: 'boolean',
              docs: 'Whether the project is completed',
            },
          },
        },
        path: `projects/{projectId}`,
      },
    });
    const generation = generator.generate(s);

    const expectedGeneration: PythonGeneration = {
      type: 'python',
      declarations: [
        {
          type: 'alias',
          modelName: 'Username',
          modelType: { type: 'str' },
          modelDocs: 'A string that uniquely identifies the user.',
        },
        {
          type: 'enum-class',
          modelName: 'UserRole',
          modelType: {
            type: 'enum-class',
            attributes: [
              { key: 'Admin', value: 'admin' },
              { key: 'User', value: 'user' },
            ],
          },
          modelDocs: null,
        },
        {
          type: 'pydantic-class',
          modelName: 'Project',
          modelType: {
            type: 'object-class',
            attributes: [
              { name: 'id', docs: 'The ID of the project', optional: false, deprecated: false, type: { type: 'str' } },
              {
                name: 'completed',
                docs: 'Whether the project is completed',
                optional: false,
                deprecated: false,
                type: { type: 'bool' },
              },
            ],
            additionalAttributes: false,
          },
          modelDocs: 'Represents a project within a workspace',
        },
      ],
    };

    expect(generation).toEqual(expectedGeneration);
  });
});

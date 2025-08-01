import { SwiftGeneration } from '../../../generators/swift/index.js';
import { createSwiftRenderer } from '../_impl.js';

describe('SwiftRendererImpl', () => {
  it('correctly renders a Swift generation', async () => {
    const renderer = createSwiftRenderer({
      indentation: 4,
      target: 'firebase@10',
    });

    const generation: SwiftGeneration = {
      type: 'swift',
      declarations: [
        {
          type: 'typealias',
          modelName: 'Username',
          modelType: {
            type: 'string',
          },
          modelDocs: 'A string that uniquely identifies the user.',
        },
        {
          type: 'typealias',
          modelName: 'UserMetadata',
          modelType: {
            type: 'any',
          },
          modelDocs: null,
        },
        {
          type: 'struct',
          modelName: 'Project',
          modelType: {
            type: 'struct',
            literalProperties: [],
            regularProperties: [
              {
                type: { type: 'string' },
                originalName: 'name',
                optional: false,
                deprecated: false,
                docs: null,
              },
              {
                type: { type: 'bool' },
                originalName: 'completed',
                optional: false,
                deprecated: false,
                docs: 'Whether the project is completed.',
              },
            ],
          },
          modelDocs: 'A project within a workspace',
        },
      ],
    };

    const result = await renderer.render(generation);

    expect(result).toMatchSnapshot();
  });
});

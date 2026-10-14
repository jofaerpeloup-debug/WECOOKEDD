let mockStateUpdateObserver = null;
jest.mock('react', () => {
  const actual = jest.requireActual('react');
  return {
    ...actual,
    useState: (initial) => {
      const [value, setValue] = actual.useState(initial);
      return [value, (update) => {
        if (mockStateUpdateObserver) mockStateUpdateObserver(update);
        return setValue(update);
      }];
    },
  };
});

const React = require('react');

jest.mock('react-native', () => {
  const React = require('react');
  const host = (name) => React.forwardRef(({ children, ...props }, ref) =>
    React.createElement(name, { ...props, ref }, children));
  return {
    ActivityIndicator: host('ActivityIndicator'),
    Image: host('Image'),
    Pressable: host('Pressable'),
    RefreshControl: host('RefreshControl'),
    ScrollView: host('ScrollView'),
    StyleSheet: {
      create: (styles) => styles,
      flatten: (style) => Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style || {},
    },
    Text: host('Text'),
    TextInput: host('TextInput'),
    View: host('View'),
  };
});

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('../src/theme/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      cream: '#fff', creamDeep: '#eee', paper: '#fff', ink: '#111', inkSoft: '#333',
      inkFaint: '#666', hairline: '#ccc', onAccent: '#fff', sagePale: '#efe',
      sageDeep: '#353', error: '#900',
    },
    shadow: { soft: {} },
  }),
}));

let mockAuth = { user: { id: 'user-a', name: 'User A' } };
jest.mock('../src/context/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('../src/components/TopBar', () => 'TopBar');
jest.mock('../src/components/RecipeImage', () => 'RecipeImage');
jest.mock('../src/api/recipeService', () => ({ listRecipes: jest.fn() }));
jest.mock('../src/api/communityService', () => ({
  createCommunityComment: jest.fn(),
  createCommunityPost: jest.fn(),
  deleteCommunityComment: jest.fn(),
  deleteCommunityPost: jest.fn(),
  listCommunityComments: jest.fn(),
  listFollowingCommunityPosts: jest.fn(),
  listSavedCommunityPosts: jest.fn(),
  listCommunityPosts: jest.fn(),
  setCommunityAuthorFollowed: jest.fn(),
  setCommunityPostBookmarked: jest.fn(),
  setCommunityPostLiked: jest.fn(),
}));
jest.mock('../src/api/communityErrors', () => ({
  getCommunityErrorMessage: (error) => error?.message || 'Community request failed.',
}));
jest.mock('../src/utils/communityTime', () => ({ formatCommunityTime: () => 'now' }));
jest.mock('../src/utils/alert', () => ({ notify: jest.fn() }));

const { act, cleanup, fireEvent, render, waitFor } = require('@testing-library/react-native');
const { listRecipes } = require('../src/api/recipeService');
const communityService = require('../src/api/communityService');
const { notify } = require('../src/utils/alert');
const CommunityScreen = require('../src/screens/CommunityScreen').default;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function post(id, commentCount = 0, overrides = {}) {
  return {
    id,
    caption: `Post ${id}`,
    createdAt: '2026-10-01T00:00:00.000Z',
    author: { id: 'user-a', name: 'User A', avatarUrl: null },
    recipeAttachment: null,
    likeCount: 0,
    likedByCurrentUser: false,
    commentCount,
    isOwner: true,
    isFollowingAuthor: false,
    bookmarkedByCurrentUser: false,
    ...overrides,
  };
}

function comment(id, body = `Comment ${id}`, overrides = {}) {
  return {
    id,
    body,
    createdAt: '2026-10-01T00:00:00.000Z',
    author: { id: 'user-a', name: 'User A', avatarUrl: null },
    isOwner: true,
    ...overrides,
  };
}

function feed(posts = [post('p1', 2), post('p2', 4)], page = 1, totalPages = 2) {
  return { posts, pagination: { page, limit: 20, total: 2, totalPages } };
}

function refreshProps(view) {
  return view.UNSAFE_getAllByType('ScrollView')[0].props.refreshControl.props;
}

async function settle(request, method, value) {
  await act(async () => {
    request[method](value);
    await request.promise.catch(() => undefined);
  });
}

beforeEach(() => {
  jest.resetAllMocks();
  mockAuth = { user: { id: 'user-a', name: 'User A' } };
  listRecipes.mockResolvedValue({ recipes: [], pagination: { page: 1, totalPages: 1 } });
  communityService.listCommunityPosts.mockResolvedValue(feed());
  communityService.listFollowingCommunityPosts.mockResolvedValue(feed([], 1, 0));
  communityService.listSavedCommunityPosts.mockResolvedValue(feed([], 1, 0));
  communityService.createCommunityPost.mockResolvedValue(post('created'));
  communityService.deleteCommunityPost.mockResolvedValue(true);
  communityService.setCommunityPostLiked.mockResolvedValue({ liked: true, likeCount: 1 });
  communityService.setCommunityAuthorFollowed.mockResolvedValue({ following: true });
  communityService.setCommunityPostBookmarked.mockResolvedValue({ bookmarked: true });
});

afterEach(() => cleanup());

it('opens an available attached recipe with the exact authoritative RecipeDetail contract', async () => {
  const navigation = { navigate: jest.fn() };
  communityService.listCommunityPosts.mockResolvedValue(feed([
    post('p1', 0, {
      recipeAttachment: {
        isAvailable: true,
        recipe: { id: 'recipe-1', title: 'Server Recipe', imageUrl: 'https://cdn/recipe.webp' },
      },
    }),
  ], 1, 1));

  const view = render(<CommunityScreen navigation={navigation} />);
  const cta = await view.findByLabelText('View Recipe');
  expect(cta.props.accessibilityRole).toBe('button');
  fireEvent.press(cta);

  expect(navigation.navigate).toHaveBeenCalledTimes(1);
  expect(navigation.navigate).toHaveBeenCalledWith('RecipeDetail', {
    recipeSource: 'api',
    recipeId: 'recipe-1',
  });
  expect(navigation.navigate.mock.calls[0][1]).toEqual({
    recipeSource: 'api',
    recipeId: 'recipe-1',
  });
});

it('opens ingredients with only a real Recipe ID while preserving View Recipe', async () => {
  const recipeId = '507f1f77bcf86cd799439099';
  const navigation = { navigate: jest.fn() };
  communityService.listCommunityPosts.mockResolvedValue(feed([
    post('p1', 0, { recipeAttachment: {
      isAvailable: true,
      recipe: { id: recipeId, title: 'Server Recipe', imageUrl: null },
    } }),
  ], 1, 1));
  const view = render(<CommunityScreen navigation={navigation} />);
  const ingredients = await view.findByLabelText('View Ingredients');
  expect(view.getByLabelText('View Recipe')).toBeOnTheScreen();
  fireEvent.press(ingredients);
  expect(navigation.navigate).toHaveBeenCalledTimes(1);
  expect(navigation.navigate).toHaveBeenCalledWith('RecipeIngredients', { recipeId });
});

it('does not expose ingredients for an invalid attachment ID', async () => {
  communityService.listCommunityPosts.mockResolvedValue(feed([
    post('p1', 0, { recipeAttachment: {
      isAvailable: true,
      recipe: { id: 'recipe-1', title: 'Legacy Recipe', imageUrl: null },
    } }),
  ], 1, 1));
  const view = render(<CommunityScreen navigation={{ navigate: jest.fn() }} />);
  await view.findByLabelText('View Recipe');
  expect(view.queryByLabelText('View Ingredients')).toBeNull();
});

it.each([
  ['unavailable attachment', { isAvailable: false, recipe: { id: 'recipe-1', title: 'Unavailable' } }],
  ['null attachment', null],
  ['missing recipe', { isAvailable: true, recipe: null }],
  ['missing recipe id', { isAvailable: true, recipe: { title: 'Missing id' } }],
  ['blank recipe id', { isAvailable: true, recipe: { id: '   ', title: 'Blank id' } }],
])('does not expose recipe navigation for %s', async (label, recipeAttachment) => {
  const navigation = { navigate: jest.fn() };
  communityService.listCommunityPosts.mockResolvedValue(feed([
    post('p1', 0, { recipeAttachment }),
  ], 1, 1));

  const view = render(<CommunityScreen navigation={navigation} />);
  await waitFor(() => expect(view.getByText('Post p1')).toBeOnTheScreen());

  expect(view.queryByLabelText('View Recipe')).toBeNull();
  expect(view.queryByLabelText('View Ingredients')).toBeNull();
  if (label === 'unavailable attachment') {
    expect(view.getByText('Recipe unavailable')).toBeOnTheScreen();
  }
  expect(navigation.navigate).not.toHaveBeenCalled();
});

it('renders server-projected post and comment avatars with initial fallback only for null', async () => {
  communityService.listCommunityPosts.mockResolvedValue(feed([
    post('p1', 1, { author: { id: 'user-a', name: 'User A', avatarUrl: 'https://cdn/post.webp' } }),
  ], 1, 1));
  communityService.listCommunityComments.mockResolvedValue({
    comments: [comment('c1', 'Avatar comment', { author: { id: 'user-b', name: 'User B', avatarUrl: 'https://cdn/comment.webp' } })],
    commentCount: 1,
    pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
  });
  const view = render(<CommunityScreen />);
  await waitFor(() => expect(view.getByLabelText('User A avatar').props.source.uri).toBe('https://cdn/post.webp'));
  fireEvent.press(view.getByLabelText('1 comments'));
  await waitFor(() => expect(view.getByLabelText('User B avatar').props.source.uri).toBe('https://cdn/comment.webp'));
});

it('loads comments only when opened and appends a missing page once without duplicates', async () => {
  const page2 = deferred();
  communityService.listCommunityComments
    .mockResolvedValueOnce({
      comments: [comment('c2'), comment('c1')],
      commentCount: 3,
      pagination: { page: 1, limit: 20, total: 3, totalPages: 2 },
    })
    .mockReturnValueOnce(page2.promise);
  const view = render(<CommunityScreen />);

  await waitFor(() => expect(view.getByText('Post p1')).toBeOnTheScreen());
  expect(communityService.listCommunityComments).not.toHaveBeenCalled();
  fireEvent.press(view.getByLabelText('2 comments'));
  await waitFor(() => expect(view.getByText('Comment c2')).toBeOnTheScreen());
  expect(communityService.listCommunityComments).toHaveBeenCalledWith('p1', { page: 1, limit: 20 });
  expect(view.getByLabelText('3 comments')).toBeOnTheScreen();

  fireEvent.press(view.getByLabelText('Load more comments'));
  fireEvent.press(view.getByLabelText('Load more comments'));
  expect(communityService.listCommunityComments).toHaveBeenCalledTimes(2);
  await settle(page2, 'resolve', {
    comments: [comment('c1'), comment('c0')],
    commentCount: 3,
    pagination: { page: 2, limit: 20, total: 3, totalPages: 2 },
  });
  expect(view.getAllByText('Comment c1')).toHaveLength(1);
  expect(view.getByText('Comment c0')).toBeOnTheScreen();
});

it('preserves the draft and rows on create failure, then uses the server comment and count on retry', async () => {
  communityService.listCommunityComments.mockResolvedValue({
    comments: [comment('c1')],
    commentCount: 2,
    pagination: { page: 1, limit: 20, total: 2, totalPages: 1 },
  });
  const failed = deferred();
  communityService.createCommunityComment.mockReturnValueOnce(failed.promise);
  const view = render(<CommunityScreen />);
  await waitFor(() => expect(view.getByLabelText('2 comments')).toBeOnTheScreen());
  fireEvent.press(view.getByLabelText('2 comments'));
  await waitFor(() => expect(view.getByText('Comment c1')).toBeOnTheScreen());

  fireEvent.changeText(view.getByLabelText('Comment'), '  My draft  ');
  fireEvent.press(view.getByLabelText('Post comment'));
  fireEvent.press(view.getByLabelText('Post comment'));
  expect(communityService.createCommunityComment).toHaveBeenCalledTimes(1);
  expect(communityService.createCommunityComment).toHaveBeenCalledWith('p1', 'My draft');
  await settle(failed, 'reject', new Error('offline'));
  expect(view.getByLabelText('Comment').props.value).toBe('  My draft  ');
  expect(view.getByText('Comment c1')).toBeOnTheScreen();
  expect(view.getByLabelText('2 comments')).toBeOnTheScreen();

  communityService.createCommunityComment.mockResolvedValueOnce({
    comment: comment('c2', 'My draft'),
    commentCount: 9,
  });
  fireEvent.press(view.getByLabelText('Post comment'));
  await waitFor(() => expect(view.getByText('My draft')).toBeOnTheScreen());
  expect(view.getByLabelText('Comment').props.value).toBe('');
  expect(view.getByLabelText('9 comments')).toBeOnTheScreen();
});

it('keeps an owned comment and count on delete failure, then removes only it on success', async () => {
  communityService.listCommunityComments.mockResolvedValue({
    comments: [comment('c1'), comment('c2', 'Keep me', { isOwner: false })],
    commentCount: 2,
    pagination: { page: 1, limit: 20, total: 2, totalPages: 1 },
  });
  const failed = deferred();
  communityService.deleteCommunityComment.mockReturnValueOnce(failed.promise);
  const view = render(<CommunityScreen />);
  await waitFor(() => expect(view.getByLabelText('2 comments')).toBeOnTheScreen());
  fireEvent.press(view.getByLabelText('2 comments'));
  await waitFor(() => expect(view.getByLabelText('Delete comment by User A')).toBeOnTheScreen());
  fireEvent.press(view.getByLabelText('Delete comment by User A'));
  await settle(failed, 'reject', new Error('offline'));
  expect(view.getByText('Comment c1')).toBeOnTheScreen();
  expect(view.getByText('Keep me')).toBeOnTheScreen();
  expect(view.getByLabelText('2 comments')).toBeOnTheScreen();
  await waitFor(() => expect(view.getByLabelText('Delete comment by User A').props.disabled).toBe(false));

  const succeeded = deferred();
  communityService.deleteCommunityComment.mockReturnValueOnce(succeeded.promise);
  fireEvent.press(view.getByLabelText('Delete comment by User A'));
  expect(communityService.deleteCommunityComment).toHaveBeenCalledTimes(2);
  await settle(succeeded, 'resolve', { deleted: true, commentCount: 1 });
  expect(view.queryByText('Comment c1')).toBeNull();
  expect(view.getByText('Keep me')).toBeOnTheScreen();
  expect(view.getByLabelText('1 comments')).toBeOnTheScreen();
});

it('does not leak a stale page into a different post or account', async () => {
  const oldPage = deferred();
  communityService.listCommunityComments
    .mockReturnValueOnce(oldPage.promise)
    .mockResolvedValueOnce({
      comments: [comment('b1', 'Post two comment')],
      commentCount: 4,
      pagination: { page: 1, limit: 20, total: 4, totalPages: 1 },
    });
  const view = render(<CommunityScreen />);
  await waitFor(() => expect(view.getByLabelText('2 comments')).toBeOnTheScreen());
  fireEvent.press(view.getByLabelText('2 comments'));
  fireEvent.press(view.getByLabelText('4 comments'));
  await waitFor(() => expect(view.getByText('Post two comment')).toBeOnTheScreen());
  await settle(oldPage, 'resolve', {
    comments: [comment('old', 'Stale post one comment')],
    commentCount: 99,
    pagination: { page: 1, limit: 20, total: 99, totalPages: 5 },
  });
  expect(view.queryByText('Stale post one comment')).toBeNull();
  expect(view.getByText('Post two comment')).toBeOnTheScreen();

  mockAuth = { user: { id: 'user-b', name: 'User B' } };
  view.rerender(<CommunityScreen />);
  await waitFor(() => expect(view.queryByLabelText('Comments panel')).toBeNull());
  expect(view.queryByText('Post two comment')).toBeNull();
});

it('retries an initial failure and performs a fresh page-one read after close and reopen', async () => {
  communityService.listCommunityComments
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({
      comments: [],
      commentCount: 0,
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    })
    .mockResolvedValueOnce({
      comments: [comment('fresh', 'Fresh reopen')],
      commentCount: 1,
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
  const view = render(<CommunityScreen />);
  await waitFor(() => expect(view.getByLabelText('2 comments')).toBeOnTheScreen());
  fireEvent.press(view.getByLabelText('2 comments'));
  await waitFor(() => expect(view.getByLabelText('Retry comments')).toBeOnTheScreen());
  expect(view.getByText('Post p1')).toBeOnTheScreen();
  fireEvent.press(view.getByLabelText('Retry comments'));
  await waitFor(() => expect(view.getByText('No comments yet. Start the conversation.')).toBeOnTheScreen());
  fireEvent.changeText(view.getByLabelText('Comment'), 'Discard on close');
  fireEvent.press(view.getByLabelText('0 comments'));
  expect(view.queryByLabelText('Comments panel')).toBeNull();
  fireEvent.press(view.getByLabelText('0 comments'));
  await waitFor(() => expect(view.getByText('Fresh reopen')).toBeOnTheScreen());
  expect(view.getByLabelText('Comment').props.value).toBe('');
  expect(communityService.listCommunityComments).toHaveBeenCalledTimes(3);
  expect(communityService.listCommunityComments).toHaveBeenLastCalledWith('p1', { page: 1, limit: 20 });
});

it('keeps an open panel through failed post deletion and clears it only after confirmed success', async () => {
  communityService.listCommunityComments.mockResolvedValue({
    comments: [comment('c1')],
    commentCount: 2,
    pagination: { page: 1, limit: 20, total: 2, totalPages: 1 },
  });
  const failed = deferred();
  communityService.deleteCommunityPost.mockReturnValueOnce(failed.promise);
  const view = render(<CommunityScreen />);
  await waitFor(() => expect(view.getByLabelText('2 comments')).toBeOnTheScreen());
  fireEvent.press(view.getByLabelText('2 comments'));
  await waitFor(() => expect(view.getByText('Comment c1')).toBeOnTheScreen());
  fireEvent.changeText(view.getByLabelText('Comment'), 'Keep this draft');
  fireEvent.press(view.getAllByLabelText('Delete post')[0]);
  expect(view.getByLabelText('Comments panel')).toBeOnTheScreen();
  await settle(failed, 'reject', new Error('offline'));
  expect(view.getByLabelText('Comment').props.value).toBe('Keep this draft');

  await waitFor(() => expect(view.getAllByLabelText('Delete post')[0].props.disabled).toBe(false));
  const succeeded = deferred();
  communityService.deleteCommunityPost.mockReturnValueOnce(succeeded.promise);
  fireEvent.press(view.getAllByLabelText('Delete post')[0]);
  expect(communityService.deleteCommunityPost).toHaveBeenCalledTimes(2);
  await settle(succeeded, 'resolve', true);
  expect(view.queryByText('Post p1')).toBeNull();
  expect(view.queryByLabelText('Comments panel')).toBeNull();
});

it('a superseded load-more finalizer cannot clear a newer refresh or replace its page', async () => {
  const oldMore = deferred();
  const refresh = deferred();
  const view = render(<CommunityScreen />);
  await waitFor(() => expect(view.getByText('Post p1')).toBeOnTheScreen());
  communityService.listCommunityPosts
    .mockReturnValueOnce(oldMore.promise)
    .mockReturnValueOnce(refresh.promise);
  fireEvent.press(view.getByText('Load more posts'));
  act(() => { refreshProps(view).onRefresh(); });
  expect(refreshProps(view).refreshing).toBe(true);

  await settle(oldMore, 'resolve', feed([post('stale-more')], 2, 2));
  expect(refreshProps(view).refreshing).toBe(true);
  expect(view.queryByText('Post stale-more')).toBeNull();
  await settle(refresh, 'resolve', feed([post('fresh')], 1, 1));
  expect(view.getByText('Post fresh')).toBeOnTheScreen();
  expect(refreshProps(view).refreshing).toBe(false);
});

it('a feed response begun before confirmed post creation cannot overwrite the new post', async () => {
  const refresh = deferred();
  communityService.createCommunityPost.mockResolvedValue(post('new-post'));
  const view = render(<CommunityScreen />);
  await waitFor(() => expect(view.getByText('Post p1')).toBeOnTheScreen());
  communityService.listCommunityPosts.mockReturnValueOnce(refresh.promise);
  act(() => { refreshProps(view).onRefresh(); });
  fireEvent.changeText(view.getByPlaceholderText("Share what you're cooking..."), 'New post');
  fireEvent.press(view.getByText('Post'));
  await waitFor(() => expect(view.getByText('Post new-post')).toBeOnTheScreen());
  await settle(refresh, 'resolve', feed([post('old-refresh')], 1, 1));
  expect(view.getByText('Post new-post')).toBeOnTheScreen();
  expect(view.queryByText('Post old-refresh')).toBeNull();
  expect(refreshProps(view).refreshing).toBe(false);
});

it('keeps the newer authoritative count when create and delete responses settle out of order', async () => {
  communityService.listCommunityComments.mockResolvedValue({
    comments: [comment('c1')],
    commentCount: 1,
    pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
  });
  const oldCreate = deferred();
  const newerDelete = deferred();
  communityService.createCommunityComment.mockReturnValueOnce(oldCreate.promise);
  communityService.deleteCommunityComment.mockReturnValueOnce(newerDelete.promise);
  const view = render(<CommunityScreen />);
  await waitFor(() => expect(view.getByLabelText('2 comments')).toBeOnTheScreen());
  fireEvent.press(view.getByLabelText('2 comments'));
  await waitFor(() => expect(view.getByText('Comment c1')).toBeOnTheScreen());
  expect(view.getByLabelText('1 comments')).toBeOnTheScreen();

  fireEvent.changeText(view.getByLabelText('Comment'), 'Created first');
  fireEvent.press(view.getByLabelText('Post comment'));
  fireEvent.press(view.getByLabelText('Delete comment by User A'));
  await settle(newerDelete, 'resolve', { deleted: true, commentCount: 1 });
  expect(view.getByLabelText('1 comments')).toBeOnTheScreen();
  await settle(oldCreate, 'resolve', { comment: comment('c2', 'Created first'), commentCount: 2 });

  expect(view.queryByText('Comment c1')).toBeNull();
  expect(view.getByText('Created first')).toBeOnTheScreen();
  expect(view.getByLabelText('1 comments')).toBeOnTheScreen();
});

it('rejects a stale comment page after a newer same-post mutation', async () => {
  const oldPage = deferred();
  communityService.listCommunityComments
    .mockResolvedValueOnce({
      comments: [comment('c2'), comment('c1')],
      commentCount: 3,
      pagination: { page: 1, limit: 20, total: 3, totalPages: 2 },
    })
    .mockReturnValueOnce(oldPage.promise);
  communityService.createCommunityComment.mockResolvedValueOnce({
    comment: comment('c3', 'Newest mutation'),
    commentCount: 4,
  });
  const view = render(<CommunityScreen />);
  await waitFor(() => expect(view.getByLabelText('2 comments')).toBeOnTheScreen());
  fireEvent.press(view.getByLabelText('2 comments'));
  await waitFor(() => expect(view.getByText('Comment c2')).toBeOnTheScreen());
  fireEvent.press(view.getByLabelText('Load more comments'));
  fireEvent.changeText(view.getByLabelText('Comment'), 'Newest mutation');
  fireEvent.press(view.getByLabelText('Post comment'));
  await waitFor(() => expect(view.getByLabelText('4 comments')).toBeOnTheScreen());

  await settle(oldPage, 'resolve', {
    comments: [comment('stale', 'Stale page row')],
    commentCount: 3,
    pagination: { page: 2, limit: 20, total: 3, totalPages: 2 },
  });
  expect(view.queryByText('Stale page row')).toBeNull();
  expect(view.getByText('Newest mutation')).toBeOnTheScreen();
  expect(view.getAllByLabelText('4 comments')).toHaveLength(2);
  expect(view.getByLabelText('Load more comments').props.disabled).toBe(false);
});

it('does not let a stale feed response replace a confirmed comment count', async () => {
  communityService.listCommunityComments.mockResolvedValue({
    comments: [comment('c1')],
    commentCount: 2,
    pagination: { page: 1, limit: 20, total: 2, totalPages: 1 },
  });
  communityService.deleteCommunityComment.mockResolvedValue({ deleted: true, commentCount: 1 });
  const staleFeed = deferred();
  const view = render(<CommunityScreen />);
  await waitFor(() => expect(view.getByLabelText('2 comments')).toBeOnTheScreen());
  fireEvent.press(view.getByLabelText('2 comments'));
  await waitFor(() => expect(view.getByText('Comment c1')).toBeOnTheScreen());
  communityService.listCommunityPosts.mockReturnValueOnce(staleFeed.promise);
  act(() => { refreshProps(view).onRefresh(); });
  fireEvent.press(view.getByLabelText('Delete comment by User A'));
  await waitFor(() => expect(view.getByLabelText('1 comments')).toBeOnTheScreen());

  await settle(staleFeed, 'resolve', feed([post('p1', 99), post('p2', 4)], 1, 2));
  expect(view.getByLabelText('1 comments')).toBeOnTheScreen();
  expect(view.queryByLabelText('99 comments')).toBeNull();
  expect(refreshProps(view).refreshing).toBe(false);
});

it('recovers pagination after initial feed loading overlaps a confirmed post create', async () => {
  const initialFeed = deferred();
  communityService.listCommunityPosts
    .mockReset()
    .mockReturnValueOnce(initialFeed.promise)
    .mockResolvedValueOnce(feed([post('new-post'), post('server-post')], 1, 2));
  communityService.createCommunityPost.mockResolvedValue(post('new-post'));
  const view = render(<CommunityScreen />);
  fireEvent.changeText(view.getByPlaceholderText("Share what you're cooking..."), 'New post');
  fireEvent.press(view.getByText('Post'));
  await waitFor(() => expect(view.getByText('Post new-post')).toBeOnTheScreen());

  await settle(initialFeed, 'resolve', feed([post('stale-post')], 1, 2));
  await waitFor(() => expect(communityService.listCommunityPosts).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(view.getByText('Post server-post')).toBeOnTheScreen());
  expect(view.getByText('Post new-post')).toBeOnTheScreen();
  expect(view.queryByText('Post stale-post')).toBeNull();
  expect(view.getByText('Load more posts')).toBeOnTheScreen();
  fireEvent.press(view.getByText('Load more posts'));
  await waitFor(() => expect(communityService.listCommunityPosts).toHaveBeenCalledTimes(3));
});

it('rejects an old-account comment response that settles after the account switch', async () => {
  const oldAccountPage = deferred();
  communityService.listCommunityComments.mockReturnValueOnce(oldAccountPage.promise);
  const view = render(<CommunityScreen />);
  await waitFor(() => expect(view.getByLabelText('2 comments')).toBeOnTheScreen());
  fireEvent.press(view.getByLabelText('2 comments'));
  mockAuth = { user: { id: 'user-b', name: 'User B' } };
  view.rerender(<CommunityScreen />);
  await waitFor(() => expect(view.queryByLabelText('Comments panel')).toBeNull());

  await settle(oldAccountPage, 'resolve', {
    comments: [comment('old-account', 'Old account row')],
    commentCount: 99,
    pagination: { page: 1, limit: 20, total: 99, totalPages: 5 },
  });
  expect(view.queryByText('Old account row')).toBeNull();
  expect(view.queryByLabelText('Comments panel')).toBeNull();
});

it('rejects a stale same-post response after close and reopen', async () => {
  const oldOpen = deferred();
  communityService.listCommunityComments
    .mockReturnValueOnce(oldOpen.promise)
    .mockResolvedValueOnce({
      comments: [comment('fresh', 'Fresh same-post reopen')],
      commentCount: 1,
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
  const view = render(<CommunityScreen />);
  await waitFor(() => expect(view.getByLabelText('2 comments')).toBeOnTheScreen());
  fireEvent.press(view.getByLabelText('2 comments'));
  fireEvent.press(view.getByLabelText('2 comments'));
  fireEvent.press(view.getByLabelText('2 comments'));
  await waitFor(() => expect(view.getByText('Fresh same-post reopen')).toBeOnTheScreen());

  await settle(oldOpen, 'resolve', {
    comments: [comment('stale', 'Stale first open')],
    commentCount: 99,
    pagination: { page: 1, limit: 20, total: 99, totalPages: 5 },
  });
  expect(view.queryByText('Stale first open')).toBeNull();
  expect(view.getByText('Fresh same-post reopen')).toBeOnTheScreen();
  expect(view.getByLabelText('1 comments')).toBeOnTheScreen();
});

it('ignores a late comment continuation after unmount', async () => {
  communityService.listCommunityComments.mockResolvedValue({
    comments: [comment('c1')],
    commentCount: 1,
    pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
  });
  const lateCreate = deferred();
  communityService.createCommunityComment.mockReturnValueOnce(lateCreate.promise);
  const view = render(<CommunityScreen />);
  await waitFor(() => expect(view.getByLabelText('2 comments')).toBeOnTheScreen());
  fireEvent.press(view.getByLabelText('2 comments'));
  await waitFor(() => expect(view.getByText('Comment c1')).toBeOnTheScreen());
  fireEvent.changeText(view.getByLabelText('Comment'), 'Late create');
  fireEvent.press(view.getByLabelText('Post comment'));
  view.unmount();

  await settle(lateCreate, 'resolve', { comment: comment('late', 'Late create'), commentCount: 2 });
  expect(notify).not.toHaveBeenCalled();
});

it('switches All/Following with fresh page one and rejects the late prior-mode payload', async () => {
  const lateAll = deferred();
  const navigation = { navigate: jest.fn() };
  const staleRecipeId = 'recipe-stale-all';
  const currentRecipeId = 'recipe-current-following';
  communityService.listCommunityPosts.mockReset().mockReturnValueOnce(lateAll.promise);
  communityService.listFollowingCommunityPosts.mockResolvedValueOnce(feed([
    post('following', 0, {
      author: { id: 'user-b', name: 'User B', avatarUrl: null },
      isOwner: false,
      isFollowingAuthor: true,
      recipeAttachment: {
        isAvailable: true,
        recipe: { id: currentRecipeId, title: 'Current Following Recipe', imageUrl: null },
      },
    }),
  ], 1, 1));
  const view = render(<CommunityScreen navigation={navigation} />);
  fireEvent.press(view.getByLabelText('Following Community posts'));
  await waitFor(() => expect(view.getByText('Post following')).toBeOnTheScreen());
  expect(communityService.listFollowingCommunityPosts).toHaveBeenCalledWith({ page: 1, limit: 20 });

  await settle(lateAll, 'resolve', feed([
    post('corrupt-all', 0, {
      recipeAttachment: {
        isAvailable: true,
        recipe: { id: staleRecipeId, title: 'Stale All Recipe', imageUrl: null },
      },
    }),
  ], 1, 1));
  expect(view.queryByText('Post corrupt-all')).toBeNull();
  expect(view.queryByText('Stale All Recipe')).toBeNull();
  expect(view.getByText('Post following')).toBeOnTheScreen();
  expect(view.getByText('Current Following Recipe')).toBeOnTheScreen();

  const ctas = view.getAllByLabelText('View Recipe');
  expect(ctas).toHaveLength(1);
  fireEvent.press(ctas[0]);
  expect(navigation.navigate).toHaveBeenCalledTimes(1);
  expect(navigation.navigate).toHaveBeenCalledWith('RecipeDetail', {
    recipeSource: 'api',
    recipeId: currentRecipeId,
  });
  expect(navigation.navigate.mock.calls).not.toContainEqual([
    'RecipeDetail',
    { recipeSource: 'api', recipeId: staleRecipeId },
  ]);
});

it('keeps follow pessimistic and single-flight per author, then reconciles every matching card', async () => {
  const mutation = deferred();
  const author = { id: 'user-b', name: 'User B', avatarUrl: null };
  communityService.listCommunityPosts.mockResolvedValue(feed([
    post('b1', 0, { author, isOwner: false }),
    post('b2', 0, { author, isOwner: false }),
  ], 1, 1));
  communityService.setCommunityAuthorFollowed.mockReturnValueOnce(mutation.promise);
  const view = render(<CommunityScreen />);
  await waitFor(() => expect(view.getAllByLabelText('Follow User B')).toHaveLength(2));
  fireEvent.press(view.getAllByLabelText('Follow User B')[0]);
  fireEvent.press(view.getAllByLabelText('Follow User B')[1]);
  expect(communityService.setCommunityAuthorFollowed).toHaveBeenCalledTimes(1);
  expect(view.queryByLabelText('Unfollow User B')).toBeNull();

  await settle(mutation, 'resolve', { following: true });
  expect(view.getAllByLabelText('Unfollow User B')).toHaveLength(2);
});

it.each([
  {
    label: 'follow',
    startingFollowing: false,
    settledFollowing: true,
    initialLabel: 'Follow User B',
    settledLabel: 'Unfollow User B',
  },
  {
    label: 'unfollow',
    startingFollowing: true,
    settledFollowing: false,
    initialLabel: 'Unfollow User B',
    settledLabel: 'Follow User B',
  },
])('completes $label from All after switching to Following and authoritatively reloads page one', async ({
  startingFollowing, settledFollowing, initialLabel, settledLabel,
}) => {
  const mutation = deferred();
  const author = { id: 'user-b', name: 'User B', avatarUrl: null };
  const allBefore = post('all-before', 0, {
    author, isOwner: false, isFollowingAuthor: startingFollowing,
  });
  const followingBefore = post('following-before', 0, {
    author, isOwner: false, isFollowingAuthor: startingFollowing,
  });
  const followingAfter = post('following-after', 0, {
    author, isOwner: false, isFollowingAuthor: settledFollowing,
  });
  communityService.listCommunityPosts.mockResolvedValue(feed([allBefore], 1, 1));
  communityService.listFollowingCommunityPosts
    .mockResolvedValueOnce(feed([followingBefore], 1, 1))
    .mockResolvedValueOnce(feed(settledFollowing ? [followingAfter] : [], 1, settledFollowing ? 1 : 0));
  communityService.setCommunityAuthorFollowed
    .mockReturnValueOnce(mutation.promise)
    .mockReturnValueOnce(new Promise(() => {}));

  const view = render(<CommunityScreen />);
  await waitFor(() => expect(view.getByLabelText(initialLabel)).toBeOnTheScreen());
  fireEvent.press(view.getByLabelText(initialLabel));
  fireEvent.press(view.getByLabelText('Following Community posts'));
  await waitFor(() => expect(view.getByText('Post following-before')).toBeOnTheScreen());
  expect(view.getByLabelText(initialLabel).props.accessibilityState.busy).toBe(true);

  await settle(mutation, 'resolve', { following: settledFollowing });
  await waitFor(() => expect(communityService.listFollowingCommunityPosts).toHaveBeenCalledTimes(2));
  if (settledFollowing) {
    await waitFor(() => expect(view.getByText('Post following-after')).toBeOnTheScreen());
    expect(view.getByLabelText(settledLabel)).toBeOnTheScreen();
  } else {
    await waitFor(() => expect(view.getByText('Not following anyone yet')).toBeOnTheScreen());
    communityService.listCommunityPosts.mockResolvedValueOnce(feed([
      post('all-after', 0, { author, isOwner: false, isFollowingAuthor: false }),
    ], 1, 1));
    fireEvent.press(view.getByLabelText('All Community posts'));
    await waitFor(() => expect(view.getByLabelText(settledLabel)).toBeOnTheScreen());
  }

  expect(view.getByLabelText(settledLabel).props.accessibilityState.busy).toBe(false);
  fireEvent.press(view.getByLabelText(settledLabel));
  expect(communityService.setCommunityAuthorFollowed).toHaveBeenCalledTimes(2);
});

it('preserves the new mode and clears pending when a cross-mode follow fails', async () => {
  const mutation = deferred();
  const author = { id: 'user-b', name: 'User B', avatarUrl: null };
  const followedPost = post('following', 0, {
    author, isOwner: false, isFollowingAuthor: true,
  });
  communityService.listCommunityPosts.mockResolvedValue(feed([followedPost], 1, 1));
  communityService.listFollowingCommunityPosts.mockResolvedValue(feed([followedPost], 1, 1));
  communityService.setCommunityAuthorFollowed
    .mockReturnValueOnce(mutation.promise)
    .mockReturnValueOnce(new Promise(() => {}));

  const view = render(<CommunityScreen />);
  await waitFor(() => expect(view.getByLabelText('Unfollow User B')).toBeOnTheScreen());
  fireEvent.press(view.getByLabelText('Unfollow User B'));
  fireEvent.press(view.getByLabelText('Following Community posts'));
  await waitFor(() => expect(view.getByText('Post following')).toBeOnTheScreen());

  await settle(mutation, 'reject', new Error('offline'));
  expect(notify).toHaveBeenCalledWith('Couldn’t update follow', 'offline');
  expect(view.getByText('Post following')).toBeOnTheScreen();
  expect(view.getByLabelText('Unfollow User B')).toBeOnTheScreen();
  expect(view.getByLabelText('Unfollow User B').props.accessibilityState.busy).toBe(false);
  fireEvent.press(view.getByLabelText('Unfollow User B'));
  expect(communityService.setCommunityAuthorFollowed).toHaveBeenCalledTimes(2);
});

it('does not let a feed read begun before a follow mutation restore stale rows or follow state', async () => {
  const staleRefresh = deferred();
  const followMutation = deferred();
  const author = { id: 'user-b', name: 'User B', avatarUrl: null };
  communityService.listCommunityPosts.mockResolvedValueOnce(feed([
    post('current', 0, { author, isOwner: false, isFollowingAuthor: false }),
  ], 1, 1));
  communityService.setCommunityAuthorFollowed.mockReturnValueOnce(followMutation.promise);
  const view = render(<CommunityScreen />);
  await waitFor(() => expect(view.getByLabelText('Follow User B')).toBeOnTheScreen());
  communityService.listCommunityPosts.mockReturnValueOnce(staleRefresh.promise);
  act(() => { refreshProps(view).onRefresh(); });
  fireEvent.press(view.getByLabelText('Follow User B'));
  await settle(followMutation, 'resolve', { following: true });
  expect(view.getByLabelText('Unfollow User B')).toBeOnTheScreen();

  await settle(staleRefresh, 'resolve', feed([
    post('corrupt-stale', 0, { author, isOwner: false, isFollowingAuthor: false }),
  ], 1, 1));
  expect(view.queryByText('Post corrupt-stale')).toBeNull();
  expect(view.getByText('Post current')).toBeOnTheScreen();
  expect(view.getByLabelText('Unfollow User B')).toBeOnTheScreen();
});

it('preserves cards on follow failure and guardedly reloads page one after Following unfollow', async () => {
  const author = { id: 'user-b', name: 'User B', avatarUrl: null };
  const followedPost = post('b1', 0, { author, isOwner: false, isFollowingAuthor: true });
  communityService.listCommunityPosts.mockResolvedValue(feed([followedPost], 1, 1));
  communityService.listFollowingCommunityPosts
    .mockResolvedValueOnce(feed([followedPost], 1, 1))
    .mockResolvedValueOnce(feed([], 1, 0));
  communityService.setCommunityAuthorFollowed
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ following: false });
  const view = render(<CommunityScreen />);
  await waitFor(() => expect(view.getByLabelText('Unfollow User B')).toBeOnTheScreen());
  fireEvent.press(view.getByLabelText('Unfollow User B'));
  await waitFor(() => expect(notify).toHaveBeenCalledWith('Couldn’t update follow', 'offline'));
  expect(view.getByText('Post b1')).toBeOnTheScreen();
  expect(view.getByLabelText('Unfollow User B')).toBeOnTheScreen();

  fireEvent.press(view.getByLabelText('Following Community posts'));
  await waitFor(() => expect(communityService.listFollowingCommunityPosts).toHaveBeenCalledTimes(1));
  fireEvent.press(view.getByLabelText('Unfollow User B'));
  await waitFor(() => expect(communityService.listFollowingCommunityPosts).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(view.getByText('Not following anyone yet')).toBeOnTheScreen());
  expect(view.getByText("Tap Follow on a post's author to see their cooking here.")).toBeOnTheScreen();
});

it('does not insert the viewer own newly-created post into Following', async () => {
  communityService.listFollowingCommunityPosts.mockResolvedValue(feed([], 1, 0));
  communityService.createCommunityPost.mockResolvedValue(post('own-new'));
  const view = render(<CommunityScreen />);
  fireEvent.press(view.getByLabelText('Following Community posts'));
  await waitFor(() => expect(view.getByText('Not following anyone yet')).toBeOnTheScreen());
  fireEvent.changeText(view.getByPlaceholderText("Share what you're cooking..."), 'Own new');
  fireEvent.press(view.getByText('Post'));
  await waitFor(() => expect(communityService.createCommunityPost).toHaveBeenCalledTimes(1));
  expect(view.queryByText('Post own-new')).toBeNull();
  expect(view.getByText('Not following anyone yet')).toBeOnTheScreen();
});

it('switches to Saved, renders its exact empty state, and requests fresh page one', async () => {
  communityService.listSavedCommunityPosts.mockResolvedValue(feed([], 1, 0));
  const view = render(<CommunityScreen />);
  fireEvent.press(view.getByLabelText('Saved Community posts'));
  await waitFor(() => expect(view.getByText('No saved posts yet')).toBeOnTheScreen());
  expect(view.getByText('Tap the bookmark icon on a post to find it here later.')).toBeOnTheScreen();
  expect(communityService.listSavedCommunityPosts).toHaveBeenCalledWith({ page: 1, limit: 20 });
  expect(view.getByPlaceholderText("Share what you're cooking...")).toBeOnTheScreen();
});

it('keeps bookmark mutation pessimistic and single-flight, then applies the server Boolean', async () => {
  const mutation = deferred();
  communityService.listCommunityPosts.mockResolvedValue(feed([post('p1')], 1, 1));
  communityService.setCommunityPostBookmarked.mockReturnValueOnce(mutation.promise);
  const view = render(<CommunityScreen />);
  await waitFor(() => expect(view.getByLabelText('Bookmark post')).toBeOnTheScreen());
  const control = view.getByLabelText('Bookmark post');
  expect(control.props.accessibilityState.selected).toBe(false);
  fireEvent.press(control);
  fireEvent.press(control);
  expect(communityService.setCommunityPostBookmarked).toHaveBeenCalledTimes(1);
  expect(view.getByLabelText('Bookmark post').props.accessibilityState.busy).toBe(true);
  await settle(mutation, 'resolve', { bookmarked: true });
  await waitFor(() => expect(view.getByLabelText('Remove bookmark')).toBeOnTheScreen());
  expect(view.getByLabelText('Remove bookmark').props.accessibilityState.selected).toBe(true);
});

it('keeps concurrent bookmark mutations independent per post until each one settles', async () => {
  const firstMutation = deferred();
  const secondMutation = deferred();
  communityService.listCommunityPosts.mockResolvedValue(feed([post('p1'), post('p2')], 1, 1));
  communityService.setCommunityPostBookmarked
    .mockReturnValueOnce(firstMutation.promise)
    .mockReturnValueOnce(secondMutation.promise);
  const view = render(<CommunityScreen />);
  await waitFor(() => expect(view.getAllByLabelText('Bookmark post')).toHaveLength(2));

  const [firstControl, secondControl] = view.getAllByLabelText('Bookmark post');
  fireEvent.press(firstControl);
  fireEvent.press(secondControl);
  expect(communityService.setCommunityPostBookmarked.mock.calls).toEqual([
    ['p1', true],
    ['p2', true],
  ]);
  expect(view.getAllByLabelText('Bookmark post').map((control) => control.props.accessibilityState.busy))
    .toEqual([true, true]);

  await settle(firstMutation, 'resolve', { bookmarked: true });
  expect(view.getByText('Post p1')).toBeOnTheScreen();
  expect(view.getByLabelText('Remove bookmark').props.accessibilityState.busy).toBe(false);
  expect(view.getByLabelText('Bookmark post').props.accessibilityState.busy).toBe(true);
  fireEvent.press(view.getByLabelText('Bookmark post'));
  expect(communityService.setCommunityPostBookmarked).toHaveBeenCalledTimes(2);

  await settle(secondMutation, 'resolve', { bookmarked: true });
  await waitFor(() => expect(view.getAllByLabelText('Remove bookmark')).toHaveLength(2));
  expect(view.getAllByLabelText('Remove bookmark').map((control) => control.props.accessibilityState.busy))
    .toEqual([false, false]);
});

it('does not let a feed read begun before bookmark success restore stale state or pagination', async () => {
  const staleRefresh = deferred();
  const mutation = deferred();
  communityService.listCommunityPosts
    .mockResolvedValueOnce(feed([post('p1')], 1, 1))
    .mockReturnValueOnce(staleRefresh.promise);
  communityService.setCommunityPostBookmarked.mockReturnValueOnce(mutation.promise);
  const view = render(<CommunityScreen />);
  await waitFor(() => expect(view.getByLabelText('Bookmark post')).toBeOnTheScreen());
  await act(async () => { refreshProps(view).onRefresh(); });
  fireEvent.press(view.getByLabelText('Bookmark post'));
  await settle(mutation, 'resolve', { bookmarked: true });
  expect(view.getByLabelText('Remove bookmark')).toBeOnTheScreen();
  await settle(staleRefresh, 'resolve', {
    posts: [post('corrupt', 0, { bookmarkedByCurrentUser: false })],
    pagination: { page: 7, limit: 20, total: 999, totalPages: 50 },
  });
  expect(view.queryByText('Post corrupt')).toBeNull();
  expect(view.getByText('Post p1')).toBeOnTheScreen();
  expect(view.getByLabelText('Remove bookmark')).toBeOnTheScreen();
});

it('preserves the card on bookmark failure and allows retry', async () => {
  communityService.listCommunityPosts.mockResolvedValue(feed([post('p1')], 1, 1));
  communityService.setCommunityPostBookmarked
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ bookmarked: true });
  const view = render(<CommunityScreen />);
  await waitFor(() => expect(view.getByLabelText('Bookmark post')).toBeOnTheScreen());
  fireEvent.press(view.getByLabelText('Bookmark post'));
  await waitFor(() => expect(notify).toHaveBeenCalledWith('Couldn’t update bookmark', 'offline'));
  expect(view.getByText('Post p1')).toBeOnTheScreen();
  fireEvent.press(view.getByLabelText('Bookmark post'));
  await waitFor(() => expect(view.getByLabelText('Remove bookmark')).toBeOnTheScreen());
});

it('authoritatively reloads Saved page one after confirmed unbookmark', async () => {
  const mutation = deferred();
  communityService.listSavedCommunityPosts
    .mockResolvedValueOnce(feed([post('saved', 0, { bookmarkedByCurrentUser: true })], 1, 1))
    .mockResolvedValueOnce(feed([post('replacement', 0, { bookmarkedByCurrentUser: true })], 1, 1));
  communityService.setCommunityPostBookmarked.mockReturnValueOnce(mutation.promise);
  const view = render(<CommunityScreen />);
  fireEvent.press(view.getByLabelText('Saved Community posts'));
  await waitFor(() => expect(view.getByText('Post saved')).toBeOnTheScreen());
  fireEvent.press(view.getByLabelText('Remove bookmark'));
  expect(view.getByText('Post saved')).toBeOnTheScreen();
  await settle(mutation, 'resolve', { bookmarked: false });
  await waitFor(() => expect(view.getByText('Post replacement')).toBeOnTheScreen());
  expect(view.queryByText('Post saved')).toBeNull();
  expect(communityService.listSavedCommunityPosts).toHaveBeenCalledTimes(2);
});

it('reloads current Saved when a save begun in All resolves after the mode switch', async () => {
  const mutation = deferred();
  communityService.listCommunityPosts.mockResolvedValue(feed([post('p1')], 1, 1));
  communityService.listSavedCommunityPosts
    .mockResolvedValueOnce(feed([], 1, 0))
    .mockResolvedValueOnce(feed([post('p1', 0, { bookmarkedByCurrentUser: true })], 1, 1));
  communityService.setCommunityPostBookmarked.mockReturnValueOnce(mutation.promise);
  const view = render(<CommunityScreen />);
  await waitFor(() => expect(view.getByLabelText('Bookmark post')).toBeOnTheScreen());
  fireEvent.press(view.getByLabelText('Bookmark post'));
  fireEvent.press(view.getByLabelText('Saved Community posts'));
  await waitFor(() => expect(view.getByText('No saved posts yet')).toBeOnTheScreen());
  await settle(mutation, 'resolve', { bookmarked: true });
  await waitFor(() => expect(view.getByText('Post p1')).toBeOnTheScreen());
  expect(communityService.listSavedCommunityPosts).toHaveBeenCalledTimes(2);
});

it('does not insert a newly-created unbookmarked post while Saved is active', async () => {
  communityService.listSavedCommunityPosts.mockResolvedValue(feed([], 1, 0));
  communityService.createCommunityPost.mockResolvedValue(post('own-new'));
  const view = render(<CommunityScreen />);
  fireEvent.press(view.getByLabelText('Saved Community posts'));
  await waitFor(() => expect(view.getByText('No saved posts yet')).toBeOnTheScreen());
  fireEvent.changeText(view.getByPlaceholderText("Share what you're cooking..."), 'Own new');
  fireEvent.press(view.getByText('Post'));
  await waitFor(() => expect(communityService.createCommunityPost).toHaveBeenCalledTimes(1));
  expect(view.queryByText('Post own-new')).toBeNull();
  expect(view.getByText('No saved posts yet')).toBeOnTheScreen();
});

it.each([
  ['All', 'Saved'],
  ['Following', 'Saved'],
  ['Saved', 'All'],
  ['Saved', 'Following'],
])('rejects a corrupt stale %s response after switching to %s', async (priorMode, currentMode) => {
  const staleRead = deferred();
  const currentPost = post(`current-${currentMode.toLowerCase()}`, 0, {
    bookmarkedByCurrentUser: currentMode === 'Saved',
  });
  const corruptPost = post(`corrupt-${priorMode.toLowerCase()}`, 0, {
    bookmarkedByCurrentUser: priorMode === 'Saved',
    recipeAttachment: {
      isAvailable: true,
      recipe: { id: 'stale-recipe', title: `Stale ${priorMode} Recipe`, imageUrl: null },
    },
  });
  const services = {
    All: communityService.listCommunityPosts,
    Following: communityService.listFollowingCommunityPosts,
    Saved: communityService.listSavedCommunityPosts,
  };

  communityService.listCommunityPosts.mockReset();
  if (priorMode === 'All') {
    communityService.listCommunityPosts.mockReturnValueOnce(staleRead.promise);
  } else {
    communityService.listCommunityPosts.mockResolvedValueOnce(feed([post('initial-all')], 1, 1));
    services[priorMode].mockReset().mockReturnValueOnce(staleRead.promise);
  }
  if (currentMode === 'All') {
    communityService.listCommunityPosts.mockResolvedValueOnce(feed([currentPost], 1, 1));
  } else {
    services[currentMode].mockReset().mockResolvedValueOnce(feed([currentPost], 1, 1));
  }

  const view = render(<CommunityScreen />);
  if (priorMode !== 'All') {
    await waitFor(() => expect(view.getByText('Post initial-all')).toBeOnTheScreen());
    fireEvent.press(view.getByLabelText(`${priorMode} Community posts`));
    await waitFor(() => expect(services[priorMode]).toHaveBeenCalledTimes(1));
  }
  fireEvent.press(view.getByLabelText(`${currentMode} Community posts`));
  await waitFor(() => expect(view.getByText(`Post current-${currentMode.toLowerCase()}`)).toBeOnTheScreen());

  await settle(staleRead, 'resolve', {
    posts: [corruptPost],
    pagination: { page: 91, limit: 20, total: 999, totalPages: 50 },
  });
  expect(view.queryByText(`Post corrupt-${priorMode.toLowerCase()}`)).toBeNull();
  expect(view.queryByText(`Stale ${priorMode} Recipe`)).toBeNull();
  expect(view.getByText(`Post current-${currentMode.toLowerCase()}`)).toBeOnTheScreen();
});

it('does not let an old-account successful bookmark update, alert, reload, or clear the new token', async () => {
  const oldMutation = deferred();
  const newMutation = deferred();
  communityService.listCommunityPosts.mockResolvedValue(feed([post('shared')], 1, 1));
  communityService.listSavedCommunityPosts
    .mockResolvedValueOnce(feed([post('shared')], 1, 1))
    .mockResolvedValueOnce(feed([post('shared', 0, { bookmarkedByCurrentUser: true })], 1, 1));
  communityService.setCommunityPostBookmarked
    .mockReturnValueOnce(oldMutation.promise)
    .mockReturnValueOnce(newMutation.promise);
  const view = render(<CommunityScreen />);
  await waitFor(() => expect(view.getByLabelText('Bookmark post')).toBeOnTheScreen());
  fireEvent.press(view.getByLabelText('Bookmark post'));
  mockAuth = { user: { id: 'user-b', name: 'User B' } };
  view.rerender(<CommunityScreen />);
  await waitFor(() => expect(communityService.listCommunityPosts).toHaveBeenCalledTimes(2));
  fireEvent.press(view.getByLabelText('Bookmark post'));
  expect(communityService.setCommunityPostBookmarked).toHaveBeenCalledTimes(2);
  fireEvent.press(view.getByLabelText('Saved Community posts'));
  await waitFor(() => expect(communityService.listSavedCommunityPosts).toHaveBeenCalledTimes(1));
  expect(view.getByLabelText('Bookmark post').props.accessibilityState.busy).toBe(true);

  await settle(oldMutation, 'resolve', { bookmarked: true });
  expect(view.getByLabelText('Bookmark post').props.accessibilityState.busy).toBe(true);
  expect(notify).not.toHaveBeenCalled();
  expect(communityService.listSavedCommunityPosts).toHaveBeenCalledTimes(1);
  fireEvent.press(view.getByLabelText('Bookmark post'));
  expect(communityService.setCommunityPostBookmarked).toHaveBeenCalledTimes(2);

  await settle(newMutation, 'resolve', { bookmarked: true });
  await waitFor(() => expect(communityService.listSavedCommunityPosts).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(view.getByLabelText('Remove bookmark')).toBeOnTheScreen());
});

it('installs no bookmark failure continuation after unmount', async () => {
  const late = deferred();
  const stateUpdateObserver = jest.fn();
  mockStateUpdateObserver = stateUpdateObserver;
  const mapDeleteSpy = jest.spyOn(Map.prototype, 'delete');
  communityService.listCommunityPosts.mockResolvedValue(feed([post('p1')], 1, 1));
  communityService.setCommunityPostBookmarked.mockReturnValueOnce(late.promise);
  try {
    const view = render(<CommunityScreen />);
    await waitFor(() => expect(view.getByLabelText('Bookmark post')).toBeOnTheScreen());
    fireEvent.press(view.getByLabelText('Bookmark post'));
    view.unmount();
    stateUpdateObserver.mockClear();
    mapDeleteSpy.mockClear();
    const feedCallsAtUnmount = communityService.listCommunityPosts.mock.calls.length
      + communityService.listFollowingCommunityPosts.mock.calls.length
      + communityService.listSavedCommunityPosts.mock.calls.length;
    await settle(late, 'reject', new Error('late bookmark failure'));
    expect(stateUpdateObserver).not.toHaveBeenCalled();
    expect(mapDeleteSpy).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(communityService.listCommunityPosts.mock.calls.length
      + communityService.listFollowingCommunityPosts.mock.calls.length
      + communityService.listSavedCommunityPosts.mock.calls.length).toBe(feedCallsAtUnmount);
  } finally {
    mockStateUpdateObserver = null;
    mapDeleteSpy.mockRestore();
  }
});

it('shows only supported API feed tabs and never offers a local Trending rank', async () => {
  communityService.listCommunityPosts.mockResolvedValue(feed([], 1, 1));
  const view = render(<CommunityScreen />);
  await waitFor(() => expect(view.getByLabelText('All Community posts')).toBeOnTheScreen());
  expect(view.getByLabelText('Following Community posts')).toBeOnTheScreen();
  expect(view.getByLabelText('Saved Community posts')).toBeOnTheScreen();
  expect(view.queryByText('Trending')).toBeNull();
  expect(view.queryByText('For You')).toBeNull();
  expect(communityService.listCommunityPosts).toHaveBeenCalledWith({ page: 1, limit: 20 });
});

it('does not let an old-account same-author follow continuation update or clear the new token', async () => {
  const oldMutation = deferred();
  const newMutation = deferred();
  const author = { id: 'shared-author', name: 'Shared Author', avatarUrl: null };
  communityService.listCommunityPosts.mockResolvedValue(feed([
    post('shared', 0, { author, isOwner: false }),
  ], 1, 1));
  communityService.setCommunityAuthorFollowed
    .mockReturnValueOnce(oldMutation.promise)
    .mockReturnValueOnce(newMutation.promise);
  const view = render(<CommunityScreen />);
  await waitFor(() => expect(view.getByLabelText('Follow Shared Author')).toBeOnTheScreen());
  fireEvent.press(view.getByLabelText('Follow Shared Author'));

  mockAuth = { user: { id: 'user-b', name: 'User B' } };
  view.rerender(<CommunityScreen />);
  await waitFor(() => expect(communityService.listCommunityPosts).toHaveBeenCalledTimes(2));
  fireEvent.press(view.getByLabelText('Follow Shared Author'));
  expect(communityService.setCommunityAuthorFollowed).toHaveBeenCalledTimes(2);
  await settle(oldMutation, 'reject', new Error('old account failure'));
  expect(notify).not.toHaveBeenCalled();
  fireEvent.press(view.getByLabelText('Follow Shared Author'));
  expect(communityService.setCommunityAuthorFollowed).toHaveBeenCalledTimes(2);

  await settle(newMutation, 'resolve', { following: true });
  expect(view.getByLabelText('Unfollow Shared Author')).toBeOnTheScreen();
});

it.each([
  ['follow', false, true],
  ['unfollow', true, false],
])('installs no late continuation when successful %s resolves after unmount', async (_label, initialFollowing, settledFollowing) => {
  const late = deferred();
  const stateUpdateObserver = jest.fn();
  mockStateUpdateObserver = stateUpdateObserver;
  const mapDeleteSpy = jest.spyOn(Map.prototype, 'delete');
  communityService.listCommunityPosts.mockResolvedValue(feed([
    post('b1', 0, {
      author: { id: 'user-b', name: 'User B', avatarUrl: null },
      isOwner: false,
      isFollowingAuthor: initialFollowing,
    }),
  ], 1, 1));
  communityService.setCommunityAuthorFollowed.mockReturnValueOnce(late.promise);
  try {
    const view = render(<CommunityScreen />);
    const actionLabel = initialFollowing ? 'Unfollow User B' : 'Follow User B';
    await waitFor(() => expect(view.getByLabelText(actionLabel)).toBeOnTheScreen());
    fireEvent.press(view.getByLabelText(actionLabel));
    expect(stateUpdateObserver).toHaveBeenCalled();
    view.unmount();
    stateUpdateObserver.mockClear();
    mapDeleteSpy.mockClear();
    const feedCallsAtUnmount = communityService.listCommunityPosts.mock.calls.length
      + communityService.listFollowingCommunityPosts.mock.calls.length;

    await settle(late, 'resolve', { following: settledFollowing });

    expect(stateUpdateObserver).not.toHaveBeenCalled();
    expect(mapDeleteSpy).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(communityService.listCommunityPosts.mock.calls.length
      + communityService.listFollowingCommunityPosts.mock.calls.length).toBe(feedCallsAtUnmount);
  } finally {
    mockStateUpdateObserver = null;
    mapDeleteSpy.mockRestore();
  }
});

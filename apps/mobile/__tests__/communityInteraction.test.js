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
  listCommunityPosts: jest.fn(),
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
  communityService.createCommunityPost.mockResolvedValue(post('created'));
  communityService.deleteCommunityPost.mockResolvedValue(true);
  communityService.setCommunityPostLiked.mockResolvedValue({ liked: true, likeCount: 1 });
});

afterEach(() => cleanup());

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

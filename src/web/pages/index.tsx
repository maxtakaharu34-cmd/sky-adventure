import SkyAdventureGame from '../components/SkyAdventureGame';

export default function Index() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-[#0d0015] via-[#1a0a2e] to-[#0d0015] flex flex-col items-center justify-center p-4">
      <div className="text-center mb-4">
        <h1 className="text-4xl md:text-5xl font-black tracking-tight bg-gradient-to-r from-yellow-300 via-pink-400 to-purple-400 bg-clip-text text-transparent">
          ✨ 空の冒険
        </h1>
        <p className="text-purple-300/60 text-sm mt-1">Explore floating islands, collect coins, defeat enemies!</p>
      </div>

      <SkyAdventureGame />

      <p className="text-purple-400/30 text-xs mt-4">
        3 Levels · Power-ups · 2P Mode · Leaderboard
      </p>
    </div>
  );
}
